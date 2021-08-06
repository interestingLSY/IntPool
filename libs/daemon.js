var http = require('http');
var async = require('async');
var util = require('util');

var Logger = require('./logger.js')

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.symbol);

	var options = {
		method: 'POST',
		hostname: coinConfig.daemon.host,
		port: coinConfig.daemon.port,
		auth: coinConfig.daemon.user + ':' + coinConfig.daemon.password,
		headers: {
			'Content-Length': 0	// 之后会修改
		},
		agent: http.Agent({ keepAlive: false })
	};

	var sendHttpRequest = function(requestJson,callback){
		options.headers['Content-Length'] = requestJson.length;
		var request = http.request(options, function(res){
			var finalData = '';
			res.setEncoding('utf8');
			res.on('data', function(chunk){
				finalData += chunk;
			});
			res.on('end', function(){
				if( res.statusCode != 200 ){
					if( res.statusCode == 401 ) logger.critical('daemon 的用户名和密码似乎有问题');
					else{
						logger.error('在向 daemon 发送请求时收到了返回码',res.statusCode);
						logger.error('命令：',requestJson);
						logger.error('daemon 的回复：',finalData);
					}
					callback({ type: 'error', message: finalData }, null);
					return;
				}

				var responseJson;
				try{
					responseJson = JSON.parse(finalData);
				}
				catch(e){
					logger.error('无法解析 daemon 发送的 JSON 字符串：',finalData);
					return;
				}

				callback(responseJson.error,responseJson);
			});
		});
		request.on('error', function(e){
			if( e.code == 'ECONNREFUSED' ) callback({ type: '钱包不在线', message: e.message }, null);
			else callback({ type: '请求错误', message: e.message }, null);
		})
		request.end(requestJson);
	}

	var cmd = function(method,args,callback){
		var requestJson = JSON.stringify({
			method: method,
			params: args,
			id: Math.floor(Math.random()*10000000) + 114514
		});
		sendHttpRequest(requestJson, function(err, result){
			if(err){
				logger.error('在给 daemon 发送命令的时候出现错误！',err.type,err.message);
				callback(err, result);
			}else callback(err, result.result);
		});
	}

	this.cmd = cmd;
	this.cmdSync = util.promisify(cmd);
}
