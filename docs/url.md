URL format
===

From painttyWidget 0.4, rooms can be identified by an unique URL which consists from room host, port and possibly password.

This makes sense when sharing your own room on the web. However, since it gives the whole information of one room and RoomManager is bypassed, it's much more difficult to ensure if it exits or just simply bad network.

The whole URL can be represented as:

	scheme://port@host|password#misc

However, from port to first number sign is encoded by base64. This is very useful for preventing users to mistakenly type to browsers. Also, it makes password not that plain, though still easy to get.

Scheme
----

URL scheme starts with `paintty`, and might be `painttys` for secure protocol.

Host
---

Can be either ip address or domain name.

Port
---

16 bits unsigned number. 

Password
---

UTF-8 encoded password. Should never longer than 16 characters.

Misc.
---

Any characters after slash is treated as miscellaneous info. Misc info is not encoded. Usually an plain misc. is much more readable for human.

Sample
--

Some URL samples:

	paintty://42143@192.81.128.133|1321

is encoded to:

	paintty://NDIxNDNAMTkyLjgxLjEyOC4xMzN8MTMyMQ==

That 

	paintty://58281@2600:3c01::f03c:91ff:fe70:bc64%0#asdasd111

is encoded to:

	paintty://NTgyODFAMjYwMDozYzAxOjpmMDNjOjkxZmY6ZmU3MDpiYzY0JTA=#asdasd111