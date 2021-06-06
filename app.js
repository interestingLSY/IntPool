var os = require('os');
var fs = require('fs');
var path = require('path');
var cluster = require('cluster')

var Website = require('./libs/website.js');
var Logger = require('./libs/logger.js');
var MulticoinPool = require('./libs/multicoinPool.js')

JSON.minify = JSON.minify || require("node-json-minify");

if(!fs.existsSync('config.json')){
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

var portalConfig = JSON.parse(JSON.minify(fs.readFileSync("config.json", {encoding: 'utf8'})));
var coinsConfig = function(){
	var result = {};
	fs.readdirSync('coinConfig').forEach(function(fileName){
		var filePath = path.join('coinConfig',fileName);
        if( !fs.existsSync(filePath) || path.extname(filePath) != '.json' ) return;

        var option = JSON.parse(JSON.minify(fs.readFileSync(filePath, {encoding: 'utf8'})));
        if(!option.enabled) return;

		var coinName = option.name;
        option.fileName = fileName;
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

var letUsGo = function(){
	startWebsite();
	startMulticoinPool();
}

letUsGo()
