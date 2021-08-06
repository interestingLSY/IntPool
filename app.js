var os = require('os');
var fs = require('fs');
var path = require('path');
var cluster = require('cluster')

var Website = require('./libs/website.js')
var Logger = require('./libs/logger.js')
var MulticoinPool = require('./libs/multicoinPool.js')
var Redis = require('./libs/redis.js')
var Daemon = require('./libs/daemon.js')

JSON.minify = JSON.minify || require("node-json-minify");

if(!fs.existsSync('config/config.json')){
	console.log('Cannot read config.json!');
	return;
}

if(cluster.isWorker){
	var portalConfig = JSON.parse(process.env.portalConfig);
	var coinsConfig = JSON.parse(process.env.coinsConfig);

	switch(process.env.workerType){
		case 'website':
			new Website(portalConfig,coinsConfig);
			break;
		case 'multicoinPool':
			new MulticoinPool(portalConfig,coinsConfig);
			break;
		default:
			console.log('BUG! Unknown workerType: ',workerType);
	}

	return;
}

function createWorker(workerName){
	return cluster.fork({
        workerType: workerName,
		portalConfig: JSON.stringify(portalConfig),
		coinsConfig: JSON.stringify(coinsConfig)
    });
}

var portalConfig = JSON.parse(fs.readFileSync(path.join('config','config.json'), {encoding: 'utf8'}));
var coinsConfig = function(){
	var result = {};
	fs.readdirSync(path.join('config','coins')).forEach(function(fileName){
		var filePath = path.join('config','coins',fileName);
        if( !fs.existsSync(filePath) || path.extname(filePath) != '.json' ) return;

        var option = JSON.parse(fs.readFileSync(filePath, {encoding: 'utf8'}));
        if(!option.enabled) return;

		var coinName = option.name;
        option.fileName = fileName;

		option.stratumServer.coin.name = option.name;
		option.stratumServer.coin.symbol = option.symbol;
		option.stratumServer.address = option.address;
		option.stratumServer.rewardRecipients = {};
		option.stratumServer.rewardRecipients[option.profitAddress] = option.fee*100;
		option.stratumServer.daemons = [ option.daemon ];

        result[coinName] = option;
    });
	return result;
}();

var startWebsite = function(){
	if(!portalConfig.website.enabled) return;
	var worker = createWorker('website');
}

var startMulticoinPool = function(){
	var worker = createWorker('multicoinPool');
}

var temporaryTest = async function(){
// 	var daemon = new Daemon(portalConfig,coinsConfig['SprintPay']);
// 	console.log( await daemon.cmdSync('listaccounts',[]) );
//
// 	var redis = new Redis(portalConfig,'qwq');
// 	console.log( await redis.cmdSync('get','intpool:coin:currentStat') );
//
// 	var stats = new Stats(portalConfig,'qaq');
// 	console.log( await stats.getCurrentStat() );
}

var letUsGo = function(){
	startWebsite();
	startMulticoinPool();
	temporaryTest();
}

letUsGo()
