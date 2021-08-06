var redis = require('redis')
var util = require('util')

var Logger = require('./logger.js')

module.exports = function(portalConfig,moduleName){
	var logger = new Logger(portalConfig,moduleName);

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

	var cmd = function(command,args,callback){
		redisClient[command](args,function(err,res){
			if(err) logger.error('Redis error',err);
			if(callback) callback(err,res);
		});
	}

	this.cmd = cmd;
	this.cmdSync = util.promisify(cmd);
}
