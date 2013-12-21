## Update Check

Finally we decided to have a updater. The bundle updater only do a one-time check to sever for the newest version info. And the server also only response once.

However, to protect main server program, this update check use a separated channel/port. Currently, we use a standalone program to do this job, make it possible for main program to do hot swapping. That is, this update service is not really a part of painttyServer.

### Request version info

painttyUpdater:

	{
		"request": "version",
		"platform": "windows x86",
		"language": "zh_TW"
	}

Possible value for `platform`:

* windows x86;
* windows x64;
* mac;

These platform may be supported in future without guarantee:

* linux x86;
* linux x64;
* unix;
* ios;
* android;
* qnx

### Response version info

	{
		"response": "version",
		"result": true,
		"info": {
			"version": 41,
			"changelog": "Add: updater bundled with client.",
			"level": 1,
			"url": "http://mrspaint.oss.aliyuncs.com/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86.zip"
		},
		"updater": {
			"version": 20
		}
	}

Here we have a quick glance:

* `version`: `version` is a number;
* `changelog`: brief change summry;
* `level`: priority of this update. Bigger is more urgent. `level` larger than 3 means "no update, no login".
* `url`: Optional. Updater has a pre-defined update url.
* `updater`: A block contains info about updater. Added from 0.42. Currently, only one sub field, `version`, indicates updater's version, which is a number, too.
