var express = require('express')
var ejs = require('ejs')
var path = require('path')
var Moment = require('moment')
var Cookies = require('cookies')

var Logger = require('./logger.js')
var Redis = require('./redis.js')
var Daemon = require('./daemon.js')

var GetReadableHr = function(hr){
	const suffixes = ['H/s','KH/s','MH/s','GH/s','TH/s','PH/s'];
	var suffixIndex = 0
	while( hr > 1000 && suffixIndex+1 < suffixes.length ){
		hr /= 1000;
		suffixIndex += 1;
	}
	return hr.toFixed(1) + ' ' + suffixes[suffixIndex];
}

var GetVagueAddress = function(address,isAdmin=false){
	if(isAdmin) return address;
	if(!address) return '';
	if( address.length <= 8 ) return address;
	var starCount = Math.min( address.length-8 , 6 );
	return address.substr(0,4) + '*'.repeat(starCount) + address.substr(address.length-4);
}

var SatoshiToCoin = function(x,precision=8){
	const satoshisPerCoin = 100000000;
	return (parseInt(x/10)*10/satoshisPerCoin).toFixed(precision);
}

module.exports = function(portalConfig,coinsConfig){
	var app = express()
	var logger = new Logger(portalConfig,'website');
	var redis = new Redis(portalConfig,'website');

	var daemons = {};
	for( var coin in coinsConfig )
		daemons[coin] = new Daemon(portalConfig,coinsConfig[coin]);
	
	var coinsStat = {};
	var addressToSId = {};
	var sIdToLabel = {};
	var minerStatCached = {};
	var UpdateStat = function(){
		addressToSId = {};
		sIdToLabel = {};
		minerStatCached = {};
		for( let coin in coinsConfig ){
			let tablePrefix = 'intpool:'+coinsConfig[coin].symbol+':';
			coinsStat[coin] = {};
			
			Promise.all([
				redis.cmdSync('LRANGE',[tablePrefix+'history',0,-1]),
				redis.cmdSync('GET',[tablePrefix+'latestStat'])
			]).then(function(result){
				((result,latestStat)=>{
					result.reverse();
					result.push(latestStat);
					for( var index in result )
						result[index] = JSON.parse(result[index]);
					const nowTime = Date.now();
					for( var record of result ){
						for( var sId in record.clientInfo ){
							var address = record.clientInfo[sId].address;
							if(!addressToSId[address]) addressToSId[address] = new Set();
							addressToSId[address].add(sId);
							sIdToLabel[sId] = record.clientInfo[sId].label;
						}
					}
					coinsStat[coin].history = result;
				})(result[0],result[1]);
				
				((latestStat)=>{
					latestStat = JSON.parse(latestStat);
					coinsStat[coin].latest = latestStat;
					coinsStat[coin].history.push(latestStat);
					
					coinsStat[coin].onlineMiners = {};
					coinsStat[coin].onlineMinersSorted = [];
					for( var sId in latestStat.clientInfo ){
						var clientInfo = latestStat.clientInfo[sId];
						var address = clientInfo.address;
						if(!coinsStat[coin].onlineMiners[address])
							coinsStat[coin].onlineMiners[address] = { hr: 0, workerCount: 0 };
						coinsStat[coin].onlineMiners[address].hr += clientInfo.hr;
						coinsStat[coin].onlineMiners[address].workerCount += 1;
					}
					for( var address in coinsStat[coin].onlineMiners )
						coinsStat[coin].onlineMinersSorted.push({
							address: address,
							hr: coinsStat[coin].onlineMiners[address].hr,
							workerCount: coinsStat[coin].onlineMiners[address].workerCount
						})
					coinsStat[coin].onlineMinersSorted.sort( (a,b)=>b.hr-a.hr );
				})(result[1]);
			});
			
			daemons[coin].cmd('getpeerinfo',[],function(err,result){
				coinsStat[coin].peerCount = result.length;
			});
			daemons[coin].cmd('getnetworkinfo',[],function(err,result){
				coinsStat[coin].version = result.subversion;
			});
			daemons[coin].cmd('getblockcount',[],function(err,result){
				coinsStat[coin].currentBlockHeight = parseInt(result);
			});
			
			redis.cmd('LRANGE',[tablePrefix+'solvedBlocks',0,24],function(err,result){
				coinsStat[coin].solvedBlocks = result.map((x)=>JSON.parse(x));
				for( let index in coinsStat[coin].solvedBlocks ){
					redis.cmd('SISMEMBER',[tablePrefix+'checkedOrphanedBlocks',coinsStat[coin].solvedBlocks[index].height],function(err,result){
						if(result) coinsStat[coin].solvedBlocks[index].isOrphanedBlock = true;
						else redis.cmd('SISMEMBER',[tablePrefix+'uncheckedOrphanedBlocks',coinsStat[coin].solvedBlocks[index].height],function(err,result){
							if(result) coinsStat[coin].solvedBlocks[index].isOrphanedBlock = true;
						});
					})
				}
			});
			redis.cmd('LLEN',[tablePrefix+'solvedBlocks'],function(err,result){
				coinsStat[coin].solvedBlockCount = result || 0;
			});
			redis.cmd('LRANGE',[tablePrefix+'paymentHistory',0,19],function(err,result){
				result = result.map((x)=>JSON.parse(x));
				coinsStat[coin].paymentHistory = result;
			});
			redis.cmd('GET',[tablePrefix+'paymentStatistics'],function(err,result){
				result = JSON.parse(result);
				coinsStat[coin].paymentStatistics = result;
			});
		}
	}
	UpdateStat();
	setInterval(function(){UpdateStat()},portalConfig.website.historyRefreshInterval*1000);
	
	app.locals.GetReadableHr = GetReadableHr;
	app.locals.GetVagueAddress = GetVagueAddress;
	app.locals.SatoshiToCoin = SatoshiToCoin;
	app.locals.Moment = Moment;
	
	app.engine('.html', require('ejs').__express);
	app.set('views', path.join(__dirname,'..','website','views'));
	app.set('view engine', 'html');
	app.use('/static', express.static(path.join(__dirname,'..','website','static')))

	app.get('/',function(req,res){
		res.render('index.html',{
			portalConfig: portalConfig,
			coinsConfig: coinsConfig
		});
	});

	app.get('/coin/:coin',async function(req,res){
		var coin = req.params.coin;
		if(!(coin in coinsConfig)){
			res.render('error.html',{
				portalConfig: portalConfig,
				coinsConfig: coinsConfig,
				errorMessage: '没找到这个货币： '+coin
			});
			return;
		}
		
		var coinConfig = coinsConfig[coin];
		var tablePrefix = 'intpool:'+coinsConfig[coin].symbol+':';
		var coinStat = coinsStat[coin];
		var cookies = new Cookies(req,res);
		var minerAddress = cookies.get('minerAddress') || '';
		
		var minerStat;
		if( minerAddress in addressToSId ){
			if(minerStatCached[minerAddress]) minerStat = minerStatCached[minerAddress];
			else minerStat = minerStatCached[minerAddress] = await (async ()=>{
				var historyHr = {};	// key: label, value: Array
				var historySumHr = [];
				addressToSId[minerAddress].forEach((sId)=>{
					historyHr[sIdToLabel[sId]] = [];
				});
				for( var record of coinStat.history ){
					var sumHr = 0;
					var index;
					addressToSId[minerAddress].forEach((sId)=>{
						historyHr[sIdToLabel[sId]].push(0);
						index = historyHr[sIdToLabel[sId]].length - 1;
					});
					addressToSId[minerAddress].forEach((sId)=>{
						var curHr = record.clientInfo[sId] ? record.clientInfo[sId].hr : 0;
						historyHr[sIdToLabel[sId]][index] += curHr;
						sumHr += curHr;
					});
					historySumHr.push(sumHr);
				}
				var accountInfo = {};
				await Promise.all([
					redis.cmdSync('HGET',[tablePrefix+'accountInfo',minerAddress])
				]).then(function(result){
					((res)=>{
						accountInfo = JSON.parse(res) || { 'unpaid': 0, 'paid': 0 };
					})(result[0]);
				});
				return {
					historyHr: historyHr,
					historySumHr: historySumHr,
					accountInfo: accountInfo
				}
			})();
		}else{
			minerStat = {
				notFound: true
			}
		}
		
		var statForAdmin = {};
		if( minerAddress == coinConfig.adminKey ){
			statForAdmin.isAdmin = true;
			await Promise.all([
				daemons[coin].cmdSync('listaccounts',[])
			]).then(function(result){
				((res)=>{
					statForAdmin.walletAccounts = res;
					statForAdmin.totalMoneyIHave = 0;
					for( var address in res ) statForAdmin.totalMoneyIHave += res[address];
				})(result[0]);
			});
		}
		
		res.render('coinIndex.html',{
			portalConfig: portalConfig,
			coinsConfig: coinsConfig,
			coinConfig: coinsConfig[coin],
			coinStat: coinStat,
			minerAddress: minerAddress,
			minerStat: minerStat,
			addressToSId: addressToSId,
			sIdToLabel: sIdToLabel,
			onlineMinersSorted: coinsStat[coin].onlineMinersSorted,
			statForAdmin: statForAdmin
		})
	});
	
	app.get('/coin/:coin/help',function(req,res){
		var coin = req.params.coin;
		if(!(coin in coinsConfig)){
			res.render('error.html',{
				portalConfig: portalConfig,
				coinsConfig: coinsConfig,
				errorMessage: '没找到这个货币： '+coin
			});
		}
		var coinConfig = coinsConfig[coin];
		res.render('coinHelp.html',{
			portalConfig: portalConfig,
			coinsConfig: coinsConfig,
			coinConfig: coinConfig
		})
	});

	// start web server
	var host = portalConfig.website.host;
	var port = portalConfig.website.port;
	app.listen(port,host,function(err){
		if(err){
			logger.critical('端口',port,'监听失败！网页端将被禁用');
			return;
		}
		logger.info('网页端正在',host+':'+port,"上监听");
	});
}
