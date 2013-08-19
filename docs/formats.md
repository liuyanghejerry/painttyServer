# All about the data formats

Data transfered by painttyServer and painttyWidget via TCP socket is a compressed json file.

## Compression

A json file will be compressed by **zlib**'s deflate way, `compress2()`, in its default level. 

And according to Qt, the result should be prepend 4 bytes as a header represents the uncompressed size.

Say, I have a 10 bytes data to compress(shown in hex):

	90 8a 97 bb c0 71 42 ac d7 f0

I should use `compress2()` in zlib and prepend 4 bytes before the result, reads as hex:

	00 00 00 0a 78 9c 9b d0 35 7d f7 81 42 a7 35 d7 3f 00 00 20 b8 06 53

Notice, the 4 bytes header, 0x0000000a, is actually an unsigned, big-endian, 32-bit integer.

## TCP pack

Even though the network today is quite fast today, TCP sockets may recieve data discontinuous. Thus, a 10 bytes data may turn to 7+3 bytes.

In paintty, we use the simple tridational but powerful way to handle this: size header.

Like compression we did, each block of data will be prepended a 4 bytes, size header, represented how long the data is, and one byte, called pack header, for other low level imformation talked in next section.

One more note, eventhough the size can reach about 2GB from the size header, there should never be any package large like that. Currently, 2MB seems a good limit to the package size.

### Pack Header

Up to now, only 3 bits is used as follow:

<table>
	<tr>
		<td>0</td>
		<td>1 - 2</td>
		<td>3 - 7</td>
	</tr>
	<tr>
		<td>compression</td>
		<td>package type</td>
		<td>reserved</td>
	</tr>
</table>


* Bit 0: To identify whether the Json file is compressed.
* Bits 1-2: To identify what the package type is.
  * `00` for `manager`
  * `01` for `command`
  * `10` for `data`
  * `11` for `message`
* Bits 3-7: reserved for future use.

## Json file

Json file differs when transfer different type of data. To avoid any trouble with case, we use lower case for all keys.

### Update Check

Finally we decided to have a updater. The bundle updater only do a one-time check to sever for the newest version info. And the server also only response once.

However, to protect main server program, this update check use a separated channal/port. Currently, we use a standalone program to do this job, make it possible for main program to do hot swapping. That is, this update service is not really a part of painttyServer.

#### Request version info

painttyUpdater:

	{
		request: "version",
		platform: "windows x86",
		language: "zh_TW"
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

#### Response version info

	{
		response: "version",
		result: true,
		info: {
			version: "0.3a",
			changelog: "Add: updater bundled with client.",
			level: 1,
			url: "http://mrspaint.oss.aliyuncs.com/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86.zip"
		}
	}

Here we have a quick glance:

* `version`: `version` is a string, not a number;
* `changelog`: brief change summry;
* `level`: priority of this update. Bigger is more urgent. `level` larger than 3 means "no update, no login".
* `url`: Optional. Updater has a pre-defined update url.

### Room list

To join a room, painttyWidget needs to know where is the room and what are ports of the room. This controled by RoomManager.

#### Request room list

painttyWidget:

	{
		request: "roomlist"
	}

painttyServer:

	{
		response: "roomlist",
		result: true,
		roomlist: [
			{
				name: 'blablabla',
				currentload: 0,
				maxload: 5,
				private: true,
				serveraddress: "192.168.1.104",
				port: 310
			},{
				name: 'bliblibli',
				currentload: 2,
				maxload: 5,
				private: false,
				serveraddress: "192.168.1.104",
				port: 8086,
			}
		]
	}

or jsut:

	{
		response: "roomlist",
		result: false
	}

### Request a new room

painttyWidget:

	{
		request: "newroom",
		info: {
			name: "",
			maxload: 8,
			welcomemsg: "",
			emptyclose: false,
			size: {
				width: 720,
				height: 480
			},
			password: ""
		}
	}

painttyServer:

	{
		response: "newroom",
		result: true,
		info: {
			port: 20391,
			password: "",
			key: "C96F36C50461C0654E7219E8BC68DF6E4C4E62D9"
		}
	}
, or:

	{
		response: "newroom",
		result: false,
		errcode: 200
	}
	
At preasent, we only support 16-character length string for name.

A successful result returns a info object, including cmdPort, password and a signed key. This is very convenient for client to login the room directly. The signed key is a token of room owner. To protect the room from being attacked by hackers or saboteurs, room owners should never spread this signed key out.

The errcode can be translate via a `errcode` table. Here, we have errcode 200 for unknown error.

* 200: unknown error.
* 201: server is busy.
* 202: name collision.
* 203: invalid name.
* 204: invalid maxMember.
* 205: invalid welcomemsg.
* 206: invalid emptyclose.
* 207: invalid password.
* 208: emptyclose not supported.
* 209: private room not supported.
* 210: too many rooms.
* 211: invalid canvasSize.

### Login Room

The login request must provide pwssword if room requires, or it fails.

#### Request Login

Login without password:

	{
		request: "login",
		password: "",
		name: "someone"
	}
	

Login with password:

	{
		request: "login",
		password: "123456",
		name: "someone"
	}

Notice, `password` is a String, not integer or others.

#### Response Login

	{
		response: "login",
		result: true,
		info: {
			historysize: 10240,
			dataport: 8086,
			msgport: 8087,
			size: {
				width: 720,
				height: 480
			},
			clientid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1'
		}
	}
	
, or

	{
		response: "login",
		result: false,
		errcode: 300
	}
	
Here, notably, the `historysize` represents history data size of data socket, which should parse as unsigned long long.
	
`errcode` table:

* 300: unknown error.
* 301: invalid name.
* 302: invalid password or lack of password.
* 303: room is full.
* 304: you're banned.
* 305: server is too busy.

#### Request archive signature

Since 0.4, server no longer sends archive automatically. Clients have to request data themselves. And once request success, clients will receive new data as well.

Archive may or may not the one client really wants. Thus, signature check is important if client try to download only part of the archive.

	{
		request: 'archivesign'
	}

#### Response archive signature

Only client logged in should be response.

	{
		response: 'archivesign',
		result: true,
		signature: 'f03e8a370aa8dc80f63a6d67401a692ae72fa530'
	}

`signature` is actually a version number of the archive. This make sense when Room owner clear all the content of the archive. Client may want to ensure if it has the updated archive via this signature. Usually client choose to delete old one and re-download the whole archive. However, this `signature` is NOT globally unique, which means two different room may have the same `signature`. Usually, this won't happen but rooms come from different RoomManager or even diffrent server is not under control. So just don't rely on it.

And a unluck one:

	{
		response: 'archivesign',
		result: false,
		errcode: 800
	}

* 800: unknown error.

At time of writing, server should always return a successful response. This is beacuse server can always have a signature even if it has an empty archive. But we still left a blank here in case we have another reason for error.

#### Request archive

This is the actual request for archive data.

	{
		request: 'archive',
		start: 0
	}

`start` here means we want archive data right from the start point of the archive. That also means we want the whole archive.

Additional `end` may used in future version, which can be useful when we have a P2P network.

	{
		request: 'archive',
		start: 100,
		end: 10340
	}

#### Response archive

	{
		response: 'archive',
		result: true,
		signature: 'f03e8a370aa8dc80f63a6d67401a692ae72fa530'
	}

After this response, server starts sending archive data.

### Room management

All room management actions need a signed key to prove that the actions are made by room owners.

#### Checkout

To ensure one room is still under control, server schedules a close action to room. Thus, room owner must checkout in time. Currently, 72 hours seems a good schedule time.

client sends:

	{
		request: 'checkout',
		key: ''
	}
	
server returns:

	{
		response: 'checkout',
		result: true,
		cycle: 72
	}
	
There's one new thing `cycle` here. Normally, remain time of a room is shown on the roomlist. But on some circumstances, `cycle` can be useful for room owner to know when to checkout next. Also, the unit of `cycle` is hour, not ms.

Failure return:

	{
		response: 'checkout',
		result: false,
		errcode: 700
	}
	
`errcode` table:

* 700: unknown error
* 701: wrong key
* 702: timeout, which means too late.

#### Close Room

client sends:

	{
		request: "close",
		key: ""
	}
	
server returns:

	{
		response: "close",
		result: true
	}

or
	
	{
		response: "close",
		result: false
	}

Since the only reason for a failed close is a wrong key, we don't use errcode here.

Besides, server will send a message via cmdSocket, telling every client to exit the room, which will look like:

	{
		action: 'close',
		info: {
			reason: 501
		}
	}

The `reason` can be:

* 500: closed by room or room manager
* 501: closed by room owner

#### Clear Layers

At present, there's no way to clear single layer in the history. The only option is to clear all layers.

To clear all layers, room owner need to send such message:

	{
		request: 'clearall',
		key: ''
	}
	
Then server may return a message contains a result:

	{
		response: 'clearall',
		result: true
	}

Like close room, the only reason for a failed request from server is that the owner send a wrong key. So we don't really need a errcode:

	{
		response: 'clearall',
		result: false
	}
	
If the request succeeds, everyone in room will recieve another message:

	{
		'action': 'clearall',
		'signature': '26d25f9100ff5d1a7d9280094299be88cb4615e1'
	}

Here the `signature` is the new signature of the archive.

### Room interaction

Interaction between client and room can be achieved via command socket or channal. For security reason, each request needs a `clientid`. If recieved `clientid` is unknown, the request may be abandoned.

#### Query Online Members

Query online members in room is fairly simple as sending a request.

	{
		request: 'onlinelist',
		clientid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1'
	}

And server may return:

	{
		response: 'onlinelist',
		result: true,
		onlinelist: [
			{
				name: 'someone'
			},
			{
				name: 'others',
			}
		]
	}
	
Or if any error:

	{
		response: 'onlinelist',
		result: false,
		errcode: 600
	}
	
`errcode` can be:

* 600: unknown error.
* 601: room is closed already. Note, this may happen because room is closed when room owner request to close, but the close state lasts to no one stays in room.

#### Notification

Notification is message sent by server. Thus, notification can only be received by client.

	{
		action: 'notify',
		content: '<span style="color: red">hello, I am server.</span>'
	}

Notice, notification IS HTML.

### Painting actions

#### Draw Point

	{
		action: "drawpoint",
		info: {
			point: {
				x: 10,
				y: 98,
			},
			brush: {
				width: 10,
				color: {
					red: 0,
					green: 0,
					blue: 0
				},
				name: "Brush"
			},
			pressure: 0.74,
			layer: "layer0",
			userid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1',
			name: "someone"
		}
	}

Note, `pressure` as a real number, should always be a double.

#### Draw Line
	
	{
		action: "drawline",
		info: {
			start: {
				x: 100,
				y: 32
			},
			end: {
				x: 107,
				y: 35
			},
			brush: {
				width: 10,
				color: {
					red: 255,
					green: 255,
					blue: 255
				},
				name: "Brush"
			},
			pressure: 0.74,
			layer: "layer1",
			userid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1',
			name: "someone"
		}
	}
	
Note, `pressure` as a real number, should always be a double.

#### Block

As of Mr.Paint 0.4, client may choose to use `block` to send bunch of paint actions. This may save bandwidth.

Single block may contains 2 to 10 paint actions, each of them is either `drawline` or `drawpoint`.

Example:

	{
		action: "block",
		block: [
			{
				action: "drawpoint",
				info: {
					point: {
						x: 10,
						y: 98,
					},
					brush: {
						width: 10,
						color: {
							red: 0,
							green: 0,
							blue: 0
						},
						name: "Brush"
					},
					pressure: 0.74,
					layer: "layer0",
					userid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1',
					name: "someone"
				}
			},
			{
				action: "drawline",
				info: {
					start: {
						x: 100,
						y: 32
					},
					end: {
						x: 107,
						y: 35
					},
					brush: {
						width: 10,
						color: {
							red: 255,
							green: 255,
							blue: 255
						},
						name: "Brush"
					},
					pressure: 0.74,
					layer: "layer1",
					userid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1',
					name: "someone"
				}
			},
			{
				action: "drawline",
				info: {
					start: {
						x: 107,
						y: 35
					},
					end: {
						x: 120,
						y: 37
					},
					brush: {
						width: 10,
						color: {
							red: 255,
							green: 255,
							blue: 255
						},
						name: "Brush"
					},
					pressure: 0.52,
					layer: "layer1",
					userid: '46b67a67f5c4369399704b6e56a05a8697d7c4b1',
					name: "someone"
				}
			}
		]
	}

Note, blocks should never contains blocks.

#### Text Message

	{
		from: "",
		to: "",
		content: ""
	}

Since server doesn't validate message at all, both `from` and `to` is not reliable. If our server does want to send a message, use cmd channal instead.

### Local Socket

We added a local socket recently, to make it possible to control server after established.

Since we don't use password to auth, local socket should bound to 127.0.0.1.

#### Broadcast

send:
	{
		request: "broadcast",
		msg:"We're closing server in 2 min!"
	}

receive:

	{
		response: "broadcast",
		result: true
	}

