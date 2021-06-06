var redis = require('redis')
var Logger = require('./../logger.js')

module.exports = function(portalConfig,coinConfig){
	var logger = new Logger(portalConfig,coinConfig.name);

	var redisClient = redis.createClient( portalConfig.redis.port , portalConfig.redis.host );
	redisClient.on('error',function(err){
		logger.error(err);
	}).on('connect',function(err){
		logger.debug('已连接到 redis 服务器');
	});

	if( portalConfig.redis.pass && portalConfig.redis.pass != "" )
		redisClient.auth(portalConfig.redis.pass,function(err){
			if(err) logger.critical('redis 的密码似乎不正确...');
		});

	this.cmd = function(command,args,callback){
		return redisClient[command](args,function(err,res){
			if(callback)
				callback(err,res);
		});
	}
}
