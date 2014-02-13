var ConfigObject = {
  pubPort: 17979,
  version: 42,
  // TODO: use a text file for changelog
  changelog: {
    'en': './changelog/en.changelog',
    'zh_cn': './changelog/zh_cn.changelog',
    'zh_tw': './changelog/zh_tw.changelog',
    'ja': './changelog/ja.changelog'
  },
  level: 2,
  url: {
    'windows x86': 'http://mrspaint.com/test/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86_0.4.zip',
    'windows x64': 'http://mrspaint.com/test/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86_0.4.zip',
    'mac': 'http://mrspaint.com/test/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_Mac_0.4.zip'
  },
  updater: {
    version: 20
  }
};

module.exports = ConfigObject;
