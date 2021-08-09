var Logger = require('./../logger.js')
var Daemon = require('./../daemon.js')
var Redis = require('./../redis.js')
var Pplnt = require('./pplnt.js')
var HrKeeper = require('./hrKeeper.js')
var PaymentProcessor = require('./paymentProcessor.js')
var OrphanedBlockFilter = require('./orphanedBlockFilter.js')
var StratumPool = require('stratum-pool')

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.symbol);
	var daemon = new Daemon(portalConfig,coinConfig);
	var redis = new Redis(portalConfig,coinConfig.symbol);
	var pplnt = new Pplnt(portalConfig,coinConfig);
	var paymentProcessor = new PaymentProcessor(portalConfig,coinConfig);
	var orphanedBlockFilter = new OrphanedBlockFilter(portalConfig,coinConfig);
	const tablePrefix = 'intpool:' + coinConfig.symbol + ':';

	/*
	key: subscriptionId
	value: {}
	*/
	var clientInfo = {};
	var hrKeepers = {};
	var RefreshClientInfoForNewRound = function(subscriptionId){
		clientInfo[subscriptionId].curRound = {
			"validShare": 0,
			"invalidShare": 0
		};
	}
	var onAuthorize = function(ip,port,subscriptionId,address,label,callback){
		logger.protocol('Authorizing',subscriptionId,address,label);
		(subscriptionId in clientInfo) || (clientInfo[subscriptionId] = {});
		clientInfo[subscriptionId] = {
			address: address,
			label: label,
			hr: 0,
			lastSubmit: -1
		}
		hrKeepers[subscriptionId] = new HrKeeper(portalConfig,coinConfig);
		RefreshClientInfoForNewRound(subscriptionId);
		callback({
			error: null,
			authorized: true,
			disconnect: false
		});
	}
	var pool = StratumPool.createPool(coinConfig.stratumServer,onAuthorize);
	pool.on('log', function(severity,logText){
		// console.log(logText);
		switch (severity){
			case 'error': logger.error(logText); break;
			case 'warning': logger.warning(logText); break;
			case 'info': logger.info(logText); break;
			case 'debug': logger.debug(logText); break;
			case 'protocol': logger.protocol(logText); break;
			default: logger.critical('Unknown severity from stratum-pool:',severity);
		}
	});
	pool.on('clientDisconnected', function(client,subscriptionId){
		delete clientInfo[subscriptionId];
		delete hrKeepers[subscriptionId];
	});
	pool.on('share', function(isValidShare, isValidBlock, shareData){
		// console.log(shareData);
		var sId = shareData.subscriptionId;
		if(!isValidShare){
			logger.warning("Invalid share from",shareData.worker,sId,shareData.error);
			clientInfo[sId].curRound.invalidShare += 1;
			return;
		}else{
			pplnt.AddNewShare(clientInfo[sId].address,Date.now(),shareData.shareDiff,shareData.blockDiff);
			clientInfo[sId].curRound.validShare += 1;
			
			// hashrate calculating
			if( clientInfo[sId].lastSubmit != -1 ){
				hrKeepers[sId].AddNewShare(Date.now(),clientInfo[sId].lastSubmit,shareData.difficulty);
				clientInfo[sId].hr = hrKeepers[sId].GetHr(clientInfo[sId].hr);
			}
			clientInfo[sId].lastSubmit = Date.now();
			
			if(isValidBlock){
				OnBlockSolutionFound(shareData);
			}
		}
	})
	
	var OnBlockSolutionFound = function(shareData){
		var solvedBlockInfo = {
			time: Date.now(),
			height: shareData.height,
			finder: clientInfo[shareData.subscriptionId].address,
			reward: shareData.blockReward,
			blockHash: shareData.blockHash,
			txHash: shareData.txHash
		};
		logger.info("OHHHH! The block solution is found!",{
			height: shareData.height,
			worker: shareData.worker,
			sId: shareData.subscriptionId,
			blockHash: shareData.blockHash
		});

		// 将这个块的信息丢到 redis 里面
		redis.cmd('LPUSH',[tablePrefix+'solvedBlocks',JSON.stringify(solvedBlockInfo)])

		// 计算本轮中所有 client 的收益，并将这个收益划分到其对应的 address 上
		var clientRewards = pplnt.GetRewards(shareData.blockReward);
		paymentProcessor.DistributeBlockReward(clientRewards);
		
		// 重置所有 clientInfo 中的 curRound
		for( var subscriptionId in clientInfo ){
			RefreshClientInfoForNewRound(subscriptionId);
		}
	}
	pool.start();
	
	var GetCurrentStat = async function(){
		var poolHrSum = 0;
		for( var sId in clientInfo ){
			poolHrSum += clientInfo[sId].hr;
		}
		var networkHr = 0;
		try{
			networkHr = await daemon.cmdSync('getnetworkhashps',[]);
		} catch(e){
			networkHr = 0;
		}
		var curStat = {
			"time": Date.now(),
			"clientInfo": clientInfo,
			"network": {
				"hr": networkHr
			},
			"pool": {
				"hr": poolHrSum
			}
		}
		return curStat;
	}
	var SaveLatestStat = async function(){
		var curStat = await GetCurrentStat();
		redis.cmd('SET',[tablePrefix+'latestStat',JSON.stringify(curStat)]);
	}
	var RecordHistoryStat = async function(){
		var curStat = await GetCurrentStat();
		redis.cmd('LPUSH',[tablePrefix+'history',JSON.stringify(curStat)])
	}
	var RemoveOutdatedStat = async function(){
		while(true){
			var lastRecord = JSON.parse(await redis.cmdSync('LINDEX',[tablePrefix+'history',-1]));
			if( lastRecord && (Date.now()-lastRecord.time) > portalConfig.pool.historyWindow*1000 ){
				redis.cmd('RPOP',[tablePrefix+'history']);
			}else{
				break;
			}
		}
	}
	
	
	pool.on('started', async function(){
		RemoveOutdatedStat();
		setInterval(()=>{
			RemoveOutdatedStat();
			RecordHistoryStat();
		},portalConfig.pool.historySaveInterval*1000);
		setInterval(()=>{
			SaveLatestStat();
		},portalConfig.pool.latestStatSaveInterval*1000);
		setInterval(()=>{
			orphanedBlockFilter.FiltrateOrphanedBlock();
			paymentProcessor.ProcessPayment();
		},coinConfig.payment.paymentInterval*1000);
		
		logger.info(coinConfig.name,'的矿池创建完毕');
	});
}
