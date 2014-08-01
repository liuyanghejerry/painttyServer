var ConfigObject = {
  pubPort: 17979,
  version: 52,
  // TODO: use a text file for changelog
  changelog: {
    'en': './changelog/en.changelog',
    'zh_cn': './changelog/zh_cn.changelog',
    'zh_tw': './changelog/zh_tw.changelog',
    'ja': './changelog/ja.changelog'
  },
  defaultlang: 'en',
  level: 2,
  url: {
    'windows x86': 'http://download.mrspaint.com/0.5/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86_0.52.zip',
    'windows x64': 'http://download.mrspaint.com/0.5/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x64_0.52.zip',
    'mac': 'http://download.mrspaint.com/0.5/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_Mac_0.52.zip'
  },
  updater: {
    version: 20
  }
};

module.exports = ConfigObject;
