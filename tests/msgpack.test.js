var msgpack = require('msgpack');
var test = require('nodeunit');

exports['Test msgpack'] = function(test){
    test.expect(1);

    var message = {
        response: "roomlist",
        result: true,
        roomlist: [
            {
                name: 'blablabla',
                currentload: 0,
                maxload: 5,
                private: true,
                serveraddress: '192.168.1.104',
                cmdport: 310
            },{
                name: 'bliblibli',
                currentload: 2,
                maxload: 5,
                private: false,
                serveraddress: '192.168.1.104',
                cmdport: 8086,
            }
        ]
    };

    var packed_message = msgpack.pack(message);
    var message2 = msgpack.unpack(packed_message);

    test.deepEqual(message2, message, "msgpack() deep test failed!");
    test.done();

};
