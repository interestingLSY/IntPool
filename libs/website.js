var express = require('express')
var ejs = require('ejs')
var path = require('path')

var Logger = require('./logger.js')

module.exports = function(portalConfig,coinsConfig){
	var app = express()
	var logger = new Logger(portalConfig,'website');

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

	app.get('/coin/:coin',function(req,res){
		coin = req.params.coin;
		logger.debug(coin);
	});

	var host = portalConfig.website.host;
	var port = portalConfig.website.port;
	app.listen(port,host,function(err){
		if(err){
			logger.critical('监听失败！网页端将被禁用');
			return;
		}
		logger.info('网页端正在',host+':'+port,"上监听...");
	});
}
