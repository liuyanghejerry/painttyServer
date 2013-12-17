var ConfigObject = {
  mode: 'dev',
  dev: {
    database: {
      connectionString: 'mongodb://localhost/paintty',
      options: {
        keepAlive: 1
      }
    },
    log: {
      enable: true,
      path: './logs'
    },
    salt: {
      path: './config/salt.key'
    },
    manager: {
      publicPort: 7070
    },
    room: {
      path: './data/room/',
      serverMsg: '欢迎使用茶绘君，我们的主页：http://mrspaint.com。\n' 
          + '如果您在使用中有任何疑问，' 
          + '请在茶绘君贴吧留言：'
           + 'http://tieba.baidu.com/f?kw=%B2%E8%BB%E6%BE%FD \n'
    }
  }
};

var realConfig = ConfigObject[ConfigObject['mode']];

module.exports = realConfig;