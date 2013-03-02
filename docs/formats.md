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

Like compressing we did, each block of data will be prepended a 4 bytes header, represented how long the data is, and one byte for other low level imformation. Up to now, only 1 bit is used to identify whether the Json file is compressed.

If you got keen eyes, you may notice this header repeats the compression header. That's true. But since the TCP layer knows nothing about the data structure, it's necessary to do so.

## Json file

Json file differs when transfer different type of data. To avoid any trouble with case, we use lower case for all keys.

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
				cmdport: 310
			},{
				name: 'bliblibli',
				currentload: 2,
				maxload: 5,
				private: false,
				serveraddress: "192.168.1.104",
				cmdport: 8086,
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
			password: ""
		}
	}

painttyServer:

	{
		response: "newroom",
		result: true
	}
, or:

	{
		response: "newroom",
		result: false,
		errcode: 200
	}
	
At preasent, we only support 16-character length string.

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

### Login Room

Since Beta, we have 3rd socket channal, command channal. When log in a room, connect to room's cmdSocket, and request login.

The login request must provide pwssword if room requires, or it fails.

#### Request Login

Login with password:

	{
		request: "login",
		password: "",
		name: "someone"
	}
	

Login without password:

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
			msgport: 8087
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
					blue: 0,
					alpha: 100
				},
				name: "Brush"
			},
			layer: "layer0",
			userid: 2459565876494606
		}
	}

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
				color: color: {
					red: 255,
					green: 255,
					blue: 255,
					alpha: 20
				},
				name: "Brush"
			},
			layer: "layer1",
			userid: 5123565876494606
		}
	}
	
<s>Notice, QColor is a temporary way to store color. RGB seems to be the best way to store and transfer, but on client, we still have a HSV model. Thus, this is not the best time to talk about it. </s>

Color now is split to four value, named RGBA. They're all between 0 to 255.

### Text Message

	{
		from: "",
		to: "",
		content: ""
	}

Since server doesn't validate message at all, both `from` and `to` is not reliable. If our server does want to send a message, use cmd channal instead.

