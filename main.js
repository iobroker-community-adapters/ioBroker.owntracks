/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';
var utils = require('./lib/utils'); // Get common adapter utils
var adapter = utils.Adapter('owntracks');

//var LE      = require(utils.controllerDir + '/lib/letsencrypt.js');
var createStreamServer = require('create-stream-server');
var mqtt = require('mqtt-connection');
var sodium = require('libsodium-wrappers');

var server;
var clients = {};

var users = '';

var nodes = {
    /*
     * FORMAT
     * tree {string} ID / Name within tree
     * description {string} Description within the tree. You may use %name% to use current value
     * common {object} Common settings
     * common.type {string} Typ (default is string)
     * common.role {string} Role (default is state)
     * native {object} Native settings
     */
    'users': {
        'id': {'tree': 'users.%id%.id', 'description': 'User ID of user %name%'},
        'name': {'tree': 'users.%id%.name', 'description': 'User name of user %name%'},
        'connected': {'tree': 'users.%id%.connected', 'description': 'Connection status of user %name%', 'common': {'type': 'boolean'}},

        'battery': {'tree': 'users.%id%.battery', 'description': 'Device battery level for %name%', 'common': {'type': 'number', 'role': 'battery', 'unit': '%', 'min': 0, 'max': 100}},
        'latitude': {'tree': 'users.%id%.latitude', 'description': 'Latitude for %name%', 'common': {'type': 'number', 'role': 'gps.latitude'}},
        'longitude': {'tree': 'users.%id%.longitude', 'description': 'Longitude for %name%', 'common': {'type': 'number', 'role': 'gps.longitude'}},
        'accuracy': {'tree': 'users.%id%.accuracy', 'description': 'Accuracy for %name%', 'common': {'type': 'number', 'uni': 'm'}},
        'encryption': {'tree': 'users.%id%.encryption', 'description': 'Encryption status for %name%', 'common': {'type': 'boolean'}},
        'timestamp': {'tree': 'users.%id%.timestamp', 'description': 'Timestamp of last refresh for %name%', 'common': {'type': 'number'}},
        'datetime': {'tree': 'users.%id%.datetime', 'description': 'Datetime of last refresh for %name%'},
        'location':
            {
                'current': {'tree': 'users.%id%.location.current', 'description': 'Current location of the %name%'},
                'entered': {'tree': 'users.%id%.location.entered', 'description': 'Timestamp the user has entered the current location', 'common': {'type': 'number'}},
                'last': {'tree': 'users.%id%.location.last', 'description': 'Last location of the %name%'},
                'left': {'tree': 'users.%id%.location.left', 'description': 'Timestamp the user has left the last location', 'common': {'type': 'number'}},
                'history': {'tree': 'users.%id%.location.history', 'description': 'History of the user entering / leaving locations'}
            }
    },
    'locations': {
        'id': {'tree': 'locations.%id%.id', 'description': 'Location ID of location %name%'},
        'name': {'tree': 'locations.%id%.name', 'description': 'Location name of location %name%'},
        'users': {'tree': 'locations.%id%.users', 'description': 'Present users in location %name%'},
        'presence': {'tree': 'locations.%id%.presence', 'description': 'Indicator whether any user is present in location %name%', 'common': {'type': 'boolean'}},
        'history': {'tree': 'locations.%id%.history', 'description': 'History of users entering / leaving location %name%'},
        'timestamp': {'tree': 'locations.%id%.timestamp', 'description': 'Timestamp of last change within the location %name%', 'common': {'type': 'number'}},
        'datetime': {'tree': 'locations.%id%.datetime', 'description': 'Datetime of last change within the location %name%'}
    }
};

/*
 * ADAPTER UNLOAD
 *
 */
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        if (server) {
            server.destroy();
            server = null;
        }
        callback();
    } catch (e) {
        callback();
    }
});

/*
 * ADAPTER LOAD
 *
 */
adapter.on('ready', main);


/*
 * Decode
 */
function decode(key, value) {
    var result = '';
    for (var i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

/*
 * Convert a timestamp to datetime
 */
function getDateTime(timestamp) {
    if (timestamp === undefined) {
        return '';
    }

    var date = new Date(timestamp);
    var day = '0' + date.getDate();
    var month = '0' + (date.getMonth() + 1);
    var year = date.getFullYear();
    var hours = '0' + date.getHours();
    var minutes = '0' + date.getMinutes();
    var seconds = '0' + date.getSeconds();
    return day.substr(-2) + '.' + month.substr(-2) + '.' + year + ' ' + hours.substr(-2) + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
}

/*
 * Creates a node
 */
function createNode(node, state) {
    adapter.setObject(
        node.node,
        {
            common: Object.assign(node.common || {}, {
                name: node.description.replace(/%name%/gi, state.name) || '',
                role: node.common !== undefined && node.common.role ? node.common.role : 'state',
                type: node.common !== undefined && node.common.type ? node.common.type : 'string'
            }),
            type: 'state',
            native: node.native || {}
        },
        set(node.node, state.val)
    );
}

/*
 * Sets a value of a node (and creates it in case of non-existence)
 */
function set(node, value) {
    if (value !== undefined) {
        adapter.setState(node, {val: value, ts: Date.now(), ack: true}, function (err) {
            err && adapter.log.error(err);
        });
    }
}

function setValue(node, state) {
    node.node = node.tree.replace(/%id%/gi, state.id);
    adapter.getObject(node.node, function (err, obj) {
        // catch error
        if (err)
            adapter.log.error(err);

        // create node if non-existent
        if (err || !obj) {
            adapter.log.debug('Creating node ' + node.node);
            createNode(node, state);
        }

        // set value
        else
            set(node.node, state.val)
    });
}

/*
 * Extracts user credentials
 */
function getUser(data) {
    return {
        namespace: data[0] || false,
        ident:     data[1] || false,
        userName:  data[2] || false,
        userId:    data[2].replace(/\s|\./g, '_').toLowerCase() || false
    };
}

/*
 *
 */
function sendState2Client(client, topic, payload) {
    // client has subscription for this ID
    if (client._subsID && client._subsID[topic]) {
        client.publish({topic: topic, payload: payload});
    } else
    //  Check patterns
    if (client._subs) {
        for (var s in client._subs) {
            if (!client._subs.hasOwnProperty(s)) continue;
            if (client._subs[s].regex.exec(topic)) {
                client.publish({topic: topic, payload: payload});
                break;
            }
        }
    }
}

/*
 *
 */
function processTopic(topic, payload, ignoreClient) {
    for (var k in clients) {
        // if get and set have different topic names, send state to issuing client too.
        if (clients[k] === ignoreClient) continue;
        sendState2Client(clients[k], topic, payload);
    }
}

/*
 *
 */
var cltFunction = function (client) {
    /*
     * EVENT: connect
     */
    client.on('connect', function (packet) {
        client.id = packet.clientId;
        if (adapter.config.user) {
            if (adapter.config.user !== packet.username ||
                adapter.config.pass !== packet.password) {
                adapter.log.warn('Client [' + packet.clientId + '] has invalid password (' + packet.password + ') or username (' + packet.username + ')');
                client.connack({returnCode: 4});
                if (clients[client.id]) delete clients[client.id];
                client.stream.end();
                return;
            }
        }

        adapter.log.info('Client [' + packet.clientId + '] connected');
        client.connack({returnCode: 0});
        clients[client.id] = client;

        // set user connected
        var u = getUser(packet.will.topic.split('/'));
        if (u.ident !== false) setValue(nodes.users.connected, {id: u.userId, name: u.userName, val: true});
    });

    /*
     * EVENT: publish
     */
    client.on('publish', function (packet) {
        var isAck = true;
        var topic = packet.topic;
        var message = packet.payload;
        adapter.log.debug('publish "' + topic + '": ' + message);

        if (packet.qos === 1) {
            client.puback({messageId: packet.messageId});
        } else if (packet.qos === 2) {
            client.pubrec({messageId: packet.messageId});
        }
        // "owntracks/iobroker/klte":
        // {
        //      "_type":"location", // location, lwt, transition, configuration, beacon, cmd, steps, card, waypoint
        //      "acc":50,           // accuracy of location in meters
        //      "batt":46,          // is the device's battery level in percent (integer)
        //      "lat":49.0026446,   // latitude
        //      "lon":8.3832128,    // longitude
        //      "tid":"te",         // is a configurable tracker-ID - ignored
        //      "tst":1472987109    // UNIX timestamp in seconds
        // }
        var u = getUser(topic.split('/'));
        if (u.ident !== adapter.config.user) {
            adapter.log.warn('publish "' + topic + '": invalid user name - "' + parts[1] + '"');
            return;
        }

        processTopic(topic, message);

        try {
            // https://owntracks.org/booklet/tech/json/
            //
            // format without encryption key
            //  {"_type":"location","tid":"XX","acc":00,"batt":00,"conn":"w","lat":00.0000000,"lon":00.0000000,"t":"u","tst":0000000000}
            //
            // format WITH encryption key
            // {"_type":"encrypted","data":"..."}
            //
            var obj = JSON.parse(message);
            obj.encryption = false;
            var decrypted = false;

            // TYPE: encrypted
            // decrypt message.data using adapter.config.encryptionKey
            if (obj._type === 'encrypted') {
                // no key set
                if (!adapter.config.encryptionKey) {
                    adapter.log.warn('No encryption key defined in settings! Please go to settings and set a key!');
                } else {
                    var cypherText = new Buffer(obj.data, 'base64');
                    var cipher = null;
                    var nonce = cypherText.slice(0, 24);
                    var key = new Buffer(32);
                    key.fill(0);
                    key.write(adapter.config.encryptionKey);

                    // try to encrypt message and catch error in case key is wrong
                    try {
                        cipher = sodium.crypto_secretbox_open_easy(cypherText.slice(24), nonce, key, "text");
                        decrypted = true;
                    } catch (e) {
                        adapter.log.warn(e)
                    }

                    obj = JSON.parse(cipher);
                    obj.encryption = true;
                }

            }

            // log
            adapter.log.info('Received ' + (obj.encryption ? 'encrypted' : 'unencrypted') + ' payload: ' + JSON.stringify(obj));

            // TYPE: transition
            // User has entered or left a region
            if (obj._type === 'transition') {
                // create location node
                var locationId = obj.desc.replace(/\s|\./g, '_').toLowerCase();
                var locationName = obj.desc;

                // user has entered location
                if (obj.event === 'enter') {
                    adapter.log.debug('User ' + u.userName + ' entered location ' + locationName + '.');

                    // update user
                    setValue(nodes.users.location.current, {id: u.userId, name: u.userName, val: locationName});
                    setValue(nodes.users.location.entered, {id: u.userId, name: u.userName, val: obj.tst});

                    // write to history of user
                    adapter.getState(nodes.users.location.history.tree.replace('%id%', u.userId), function (err, state) {
                        var history = state === null ? [] : JSON.parse(state.val);
                        setValue(nodes.users.location.history, {
                            id: u.userId,
                            name: u.userName,
                            val: JSON.stringify(history.concat([obj]))
                        });
                    });

                    // update location (add user if not present yet for some reason)
                    adapter.getState(nodes.locations.users.tree.replace('%id%', locationId), function (err, state) {
                        users = (state === null ? '' : state.val);
                        adapter.log.debug(users === '' ? 'No users are currently in location ' + locationName + '.' : 'Users currently in location ' + locationName + ': ' + users);

                        if (users.indexOf(u.userId) === -1) {
                            setValue(nodes.locations.id, {id: locationId, name: locationName, val: locationId});
                            setValue(nodes.locations.name, {id: locationId, name: locationName, val: locationName});
                            setValue(nodes.locations.users, {
                                id: locationId,
                                name: locationName,
                                val: users + u.userId + ','
                            });
                            setValue(nodes.locations.presence, {id: locationId, name: locationName, val: true});
                            setValue(nodes.locations.timestamp, {id: locationId, name: locationName, val: obj.tst});
                            setValue(nodes.locations.datetime, {
                                id: locationId,
                                name: locationName,
                                val: getDateTime(obj.tst * 1000)
                            });

                            // write to history
                            adapter.getState(nodes.locations.history.tree.replace('%id%', locationId), function (err, state) {
                                var history = state === null ? [] : JSON.parse(state.val);
                                setValue(nodes.locations.history, {
                                    id: locationId,
                                    name: locationName,
                                    val: JSON.stringify(history.concat([obj]))
                                });
                            });
                        }
                    });
                }

                // user has left location
                else if (obj.event === 'leave') {
                    adapter.log.debug('User ' + u.userName + ' left location ' + locationName + '.');

                    // update last location of user
                    adapter.getState(nodes.users.location.current.tree.replace('%id%', u.userId), function (err, state) {
                        setValue(nodes.users.location.last, {
                            id: u.userId,
                            name: u.userName,
                            val: state === null ? '' : state.val
                        });
                        setValue(nodes.users.location.left, {id: u.userId, name: u.userName, val: obj.tst});
                    });

                    // update user
                    setValue(nodes.users.location.current, {id: u.userId, name: u.userName, val: ''});
                    setValue(nodes.users.location.entered, {id: u.userId, name: u.userName, val: ''});

                    // write to history of user
                    adapter.getState(nodes.users.location.history.tree.replace('%id%', u.userId), function (err, state) {
                        var history = state === null ? [] : JSON.parse(state.val);
                        setValue(nodes.users.location.history, {
                            id: u.userId,
                            name: u.userName,
                            val: JSON.stringify(history.concat([obj]))
                        });
                    });

                    // update location (remove user if present)
                    adapter.getState(nodes.locations.users.tree.replace('%id%', locationId), function (err, state) {
                        users = (state === null ? '' : state.val);
                        adapter.log.debug(users === '' ? 'No users are currently in location ' + locationName + '.' : 'Users currently in location ' + locationName + ': ' + users);

                        if (users.indexOf(u.userId) > -1) {
                            users = users.replace(u.userId + ',', '');
                            setValue(nodes.locations.presence, {
                                id: locationId,
                                name: locationName,
                                val: !!users
                            });
                            setValue(nodes.locations.users, {id: locationId, name: locationName, val: users});
                            setValue(nodes.locations.timestamp, {id: locationId, name: locationName, val: obj.tst});
                            setValue(nodes.locations.datetime, {
                                id: locationId,
                                name: locationName,
                                val: getDateTime(obj.tst * 1000)
                            });

                            // write to history
                            adapter.getState(nodes.locations.history.tree.replace('%id%', locationId), function (err, state) {
                                var history = state === null ? [] : JSON.parse(state.val);
                                setValue(nodes.locations.history, {
                                    id: locationId,
                                    name: locationName,
                                    val: JSON.stringify(history.concat([obj]))
                                });
                            });
                        }
                    });
                }
            }

            // TYPE: location
            // message sent unencrypted or has been decrypted
            if (obj._type === 'location') {
                setValue(nodes.users.id, {id: u.userId, name: u.userName, val: u.userId});
                setValue(nodes.users.name, {id: u.userId, name: u.userName, val: u.userName});
                setValue(nodes.users.connected, {id: u.userId, name: u.userName, val: true});

                setValue(nodes.users.encryption, {id: u.userId, name: u.userName, val: obj.encryption});
                setValue(nodes.users.accuracy, {id: u.userId, name: u.userName, val: obj.acc});
                setValue(nodes.users.battery, {id: u.userId, name: u.userName, val: obj.batt});
                setValue(nodes.users.longitude, {id: u.userId, name: u.userName, val: obj.lon});
                setValue(nodes.users.latitude, {id: u.userId, name: u.userName, val: obj.lat});
                setValue(nodes.users.timestamp, {id: u.userId, name: u.userName, val: obj.tst});
                setValue(nodes.users.datetime, {id: u.userId, name: u.userName, val: getDateTime(obj.tst * 1000)});
            }
        } catch (e) {
            adapter.log.error('Cannot parse payload: ' + message);
            adapter.log.error(e);
        }

    });

    /*
     * EVENT: subscribe
     */
    client.on('subscribe', function (packet) {
        var granted = [];
        if (!client._subsID) client._subsID = {};
        if (!client._subs) client._subs = {};

        for (var i = 0; i < packet.subscriptions.length; i++) {
            granted.push(packet.subscriptions[i].qos);

            var topic = packet.subscriptions[i].topic;

            adapter.log.debug('Subscribe on ' + topic);
            // if pattern without wildchars
            if (topic.indexOf('*') === -1 && topic.indexOf('#') === -1 && topic.indexOf('+') === -1) {
                client._subsID[topic] = {
                    qos: packet.subscriptions[i].qos
                };
            } else {
                // "owntracks/+/+/info" => owntracks\/.+\/.+\/info
                var pattern = topic.replace(/\//g, '\\/').replace(/\+/g, '[^\\/]+').replace(/\*/g, '.*');
                pattern = '^' + pattern + '$';

                // add simple pattern
                client._subs[topic] = {
                    regex: new RegExp(pattern),
                    qos: packet.subscriptions[i].qos,
                    pattern: topic
                };
            }
        }

        client.suback({granted: granted, messageId: packet.messageId});
        //Subscribe on owntracks/+/+
        //Subscribe on owntracks/+/+/info
        //Subscribe on owntracks/iobroker/denis/cmd
        //Subscribe on owntracks/+/+/event
        //Subscribe on owntracks/+/+/waypoint

        // send to client all images
        if (adapter.config.pictures && adapter.config.pictures.length) {
            setTimeout(function () {
                for (var p = 0; p < adapter.config.pictures.length; p++) {
                    var text = adapter.config.pictures[p].base64.split(',')[1]; // string has form data:;base64,TEXT==
                    sendState2Client(client, 'owntracks/' + adapter.config.user + '/' + adapter.config.pictures[p].name + '/info',
                        JSON.stringify({
                            _type: 'card',
                            name: adapter.config.pictures[p].name,
                            face: text
                        })
                    );
                }
            }, 200);
        }
    });

    /*
     * EVENT: pingreq
     */
    client.on('pingreq', function (packet) {
        adapter.log.debug('Client [' + client.id + '] pingreq');
        client.pingresp();
    });

    /*
     * EVENT: disconnect
     */
    client.on('disconnect', function (packet) {
        adapter.log.info('Client [' + client.id + '] disconnected');

        // set user disconnected
        var u = getUser(Object.keys(client._subsID).toString().split('/'));
        if (u.ident !== false) setValue(nodes.users.connected, {id: u.userId, name: u.userName, val: false});

        // disconnect
        client.stream.end();
    });

    /*
     * EVENT: close
     */
    client.on('close', function (err) {
        adapter.log.info('Client [' + client.id + '] closed');
        delete clients[client.id];

        // set user disconnected
        if (client._subsID !== undefined) {
            var u = getUser(Object.keys(client._subsID).toString().split('/'));
            if (u.ident !== false) setValue(nodes.users.connected, {id: u.userId, name: u.userName, val: false});
        }
    });

    client.on('error', function (err) {
        adapter.log.warn('[' + client.id + '] ' + err);
    });
};


function initMqttServer(config) {
    var serverConfig = {};
    var options = {
        ssl: config.certificates,
        emitEvents: true // default
    };

    config.webSocket = true;
    config.port = parseInt(config.port, 10) || 1883;

    if (config.ssl) {
        serverConfig.mqtts = 'ssl://0.0.0.0:' + config.port;
        if (config.webSocket) {
            serverConfig.mqtwss = 'wss://0.0.0.0:' + (config.port + 1);
        }
    } else {
        serverConfig.mqtts = 'tcp://0.0.0.0:' + config.port;
        if (config.webSocket) {
            serverConfig.mqtwss = 'ws://0.0.0.0:' + (config.port + 1);
        }
    }

    server = createStreamServer(serverConfig, options, function (clientStream) {
        cltFunction(mqtt(clientStream, {
            notData: !options.emitEvents
        }));
    });

    // to start
    server.listen(function () {
        if (config.ssl) {
            adapter.log.info('Starting MQTT (Secure) ' + (config.user ? 'authenticated ' : '') + 'server on port ' + config.port);
            if (config.webSocket) {
                adapter.log.info('Starting MQTT-WebSocket (Secure) ' + (config.user ? 'authenticated ' : '') + 'server on port ' + (config.port + 1));
            }
        } else {
            adapter.log.info('Starting MQTT ' + (config.user ? 'authenticated ' : '') + 'server on port ' + config.port);
            if (config.webSocket) {
                adapter.log.info('Starting MQTT-WebSocket ' + (config.user ? 'authenticated ' : '') + 'server on port ' + (config.port + 1));
            }
        }
    });
}

function main() {
    //noinspection JSUnresolvedVariable
    adapter.config.pass = decode('Zgfr56gFe87jJOM', adapter.config.pass || "");
    adapter.config.encryptionKey = decode('Zgfr56gFe87jJOM', adapter.config.encryptionKey || "");

    if (!adapter.config.user) {
        adapter.log.error('Empty user name not allowed!');
        process.stop(-1);
        return;
    }

    // create default nodes
    // ..

    //
    if (adapter.config.secure) {
        // Load certificates
        adapter.getCertificates(function (err, certificates, leConfig) {
            adapter.config.certificates = certificates;
            adapter.config.leConfig = leConfig;
            initMqttServer(adapter.config);
        });
    } else {
        initMqttServer(adapter.config);
    }
}
