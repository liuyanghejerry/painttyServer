var ConfigObject = {
  pubPort: 7979,
  version: '0.42',
  // TODO: use a text file for changelog
  changelog: {
    'en': './changelog/en.changelog',
    'zh_cn': './changelog/zh_cn.changelog',
    'zh_tw': './changelog/zh_tw.changelog',
    'ja': './changelog/ja.changelog'
  },
  level: 2,
  url: {
    'windows': 'http://download.mrspaint.com/0.4/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86_0.4.zip',
    'mac': 'http://download.mrspaint.com/0.4/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_Mac_0.4.zip'
  }
};

module.exports = ConfigObject;
