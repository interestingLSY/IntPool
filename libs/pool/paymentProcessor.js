var async = require('async');
var Logger = require('./../logger.js')
var Daemon = require('./../daemon.js')
var Redis = require('./../redis.js')

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.symbol);
	var daemon = new Daemon(portalConfig,coinConfig);
	var redis = new Redis(portalConfig,coinConfig.symbol);
	const tablePrefix = 'intpool:'+coinConfig.symbol+':';
	const satoshisPerCoin = 100000000;
	
	var SatoshiToCoin = function(x){
		return (parseInt(x/10)*10/satoshisPerCoin).toFixed(8);
	}
	
	this.DistributeBlockReward = async function(clientRewards){
		var uncheckedOrphanedBlockCount = await redis.cmdSync('SCARD',[tablePrefix+'uncheckedOrphanedBlocks']);
		if(uncheckedOrphanedBlockCount){
			var checkedOrphanedBlockHeight = await redis.cmdSync('SPOP',[tablePrefix+'uncheckedOrphanedBlocks']);
			redis.cmd('SADD',[tablePrefix+'checkedOrphanedBlocks',checkedOrphanedBlockHeight]);
		}else{
			for( let clientAddress in clientRewards ){
				redis.cmd('HGET',[tablePrefix+'accountInfo',clientAddress],function(err,res){
					if(err) return;
					res = res ? JSON.parse(res) : { "unpaid": 0, "paid": 0 };
					res.unpaid += clientRewards[clientAddress];
					redis.cmd('HSET',[tablePrefix+'accountInfo',clientAddress,JSON.stringify(res)]);
				})
			}
		}
	}
	
	this.ProcessPayment = async function(){
		var uncheckedOrphanedBlockCount = await redis.cmdSync('SCARD',[tablePrefix+'uncheckedOrphanedBlocks']);
		if(uncheckedOrphanedBlockCount){
			// 存在未补偿的孤块，无法进行支付
			logger.info("暂时还有孤块没有处理，停止支付");
			return;
		}
		
		// 1. 统计需要支付的账户和数额
		var needToPay = {}, sumOfNeedToPay = 0;	// key: address, value: 要付的钱
		var accountsInfo = await redis.cmdSync('HGETALL',[tablePrefix+'accountInfo']);
		for( var address in accountsInfo )
			accountsInfo[address] = JSON.parse(accountsInfo[address]);
		for( var address in accountsInfo ){
			var unpaid = accountsInfo[address].unpaid;
			if( unpaid > coinConfig.payment.minimumPayment*satoshisPerCoin ){
				needToPay[address] = unpaid;
				sumOfNeedToPay += unpaid;
			}
		}
		if( sumOfNeedToPay == 0 ){
			// 不需要支付
			return;
		}
		
		// 2. 检查余额是否足够
		var balance = parseInt((await daemon.cmdSync('getbalance',['pool-receive-coin']))*satoshisPerCoin+0.1);
		if( balance < sumOfNeedToPay ){
			logger.error('付款时余额不足！需要支付：',sumOfNeedToPay/satoshisPerCoin,'余额：',balance/satoshisPerCoin);
			return;
		}
		
		// 3. 更新 redis 中的账户信息
		for( let address in needToPay ){
			var newAccountInfo = accountsInfo[address];
			newAccountInfo.unpaid = 0;
			newAccountInfo.paid += needToPay[address];
			redis.cmd('HSET',[tablePrefix+'accountInfo',address,JSON.stringify(newAccountInfo)],function(err,result){
				if(err){
					logger.error('支付过程中出现错误！位置：3.1，',err);
				}
			});
		}
		
		// 4. 进行支付
		// 祝君武运昌隆
		var recipientsJsonObj = {};
		for( let address in needToPay ){
			if( !address || address.length != 34 ) continue;
			
			if( address == "MsUeV98PhHKDqBw8dZMWenfT41XJ939k6w" ) continue;
			else recipientsJsonObj[address] = SatoshiToCoin(needToPay[address]);
		}
		daemon.cmd('sendmany',['pool-receive-coin',recipientsJsonObj],function(err,result){
			if(err){
				logger.error('支付出错，停止本轮支付');
				return;
			}
			logger.info('支付成功！总支付额：',SatoshiToCoin(sumOfNeedToPay),'daemon 返回的 result: ',result);
			
			// 5. 将支付记录放进 redis 里
			var paymentInfo = {
				time: Date.now(),
				amount: sumOfNeedToPay,
				recipients: needToPay,
				txId: result
			};
			redis.cmd('LPUSH',[tablePrefix+'paymentHistory',JSON.stringify(paymentInfo)]);
			
			// 6. 更新 redis 中的 paymentStatistics
			// TODO: Use RedisJSON
			redis.cmd('GET',[tablePrefix+'paymentStatistics'],function(err,statistics){
				statistics = JSON.parse(statistics);
				if(!statistics) statistics = {
					totalAmount: 0
				};
				statistics.totalAmount += sumOfNeedToPay;
				redis.cmd('SET',[tablePrefix+'paymentStatistics',JSON.stringify(statistics)]);
			})
		});
	}
}
