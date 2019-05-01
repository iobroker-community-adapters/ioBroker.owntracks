/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */
'use strict';
const adapterName = require('./io-package.json').common.name;
const utils = require('@iobroker/adapter-core'); // Get common adapter utils

const sodium = require('libsodium-wrappers');
const Library = require(__dirname + '/lib/library.js');
const NODES = require('./_NODES.json'); // stringify, so object can be easily copied later

let code = 'Zgfr56gFe87jJOM';
let adapter;
let library;
let mqtt;

let USERS = {};
let AVATARS = {};
let LOCATIONS = {};


/*
 * ADAPTER
 *
 */
function startAdapter(options)
{
	options = options || {};
    Object.assign(options,
	{
        name: adapterName
    });
	
    adapter = new utils.Adapter(options);
	library = new Library(adapter);
	
    /*
     * ADAPTER LOAD
     *
     */
    adapter.on('ready', function()
	{
		// MQTT not selected
		if (!adapter.config.mqtt)
		{
			adapter.log.warn('Select a MQTT instance in ioBroker.owntracks settings!');
			return;
		}
		else
			mqtt = 'mqtt.' + adapter.config.mqtt;
		
		// get avatars from config
		adapter.config.pictures.forEach(function(avatar)
		{
			// verify content
			if (!avatar.name || !avatar.base64) return;
			
			// remember and do only once per session
			avatar.id = avatar.name.replace(/\s|\./g, '_').toLowerCase();
			AVATARS[avatar.id] = {
				'_type': 'card',
				'name': avatar.name,
				'face': avatar.base64.substr(avatar.base64.indexOf(',')+1)
			};
		});
		
		// get users from states
		adapter.getStates('users.*', function(err, states)
		{
			for (let key in states)
			{
				key = key.replace('owntracks.0.users.', '');
				let index = key.substr(0, key.indexOf('.'));
				
				if (states['owntracks.0.users.' + key])
				{
					USERS[index] = USERS[index] === undefined ? {avatar: false} : USERS[index];
					USERS[index][key.substr(key.indexOf('.')+1)] = key.indexOf('.history') > -1 ? JSON.parse(states['owntracks.0.users.' + key].val || {}) : states['owntracks.0.users.' + key].val || '';
				}
			}
		});
		
		// get locations from states
		adapter.getStates('locations.*', function(err, states)
		{
			for (let key in states)
			{
				key = key.replace('owntracks.0.locations.', '');
				let index = key.substr(0, key.indexOf('.'));
				
				if (states['owntracks.0.locations.' + key])
				{
					LOCATIONS[index] = LOCATIONS[index] === undefined ? {} : LOCATIONS[index];
					LOCATIONS[index][key.substr(key.indexOf('.')+1)] = key.indexOf('.history') > -1 ? JSON.parse(states['owntracks.0.locations.' + key].val) : states['owntracks.0.locations.' + key].val;
				}
			}
		});
		
		// subscribe to states of MQTT adapter
		// @see https://owntracks.org/booklet/tech/json/#topics
		try
		{
			adapter.subscribeForeignStates(mqtt + '.*');
		}
		catch(err)
		{
			adapter.log.warn(err);
		}
		
		// set timeout for disconnection (in min)
		adapter.config.disconnect = adapter.config.disconnect || 5;
		const offset = adapter.config.disconnect * 60 * 1000;
		
		let timeout = setTimeout(function disconnect()
		{
			// disconnect user after inactivity
			for (let key in USERS)
			{
				if (USERS[key].lastSeen+offset < Date.now())
				{
					setUser(USERS[key].userId, {'userConnected': false})
					//library.set();
				}
			}
			
		});
	});
	
	/*
	 * HANDLE MESSAGES
	 *
	 */
	adapter.on('message', function(msg)
	{
		adapter.log.debug('Message: ' + JSON.stringify(msg));
		
		switch(msg.command)
		{
			case 'getMQTTInstances':
				let instances = getMQTTInstances(function(err, instances)
				{
					if (err)
						library.msg(msg.from, msg.command, {result: false, error: err}, msg.callback);
						
					else
						library.msg(msg.from, msg.command, {result: true, instances: instances}, msg.callback);
				});
				break;
		}
	});

	/*
	 * STATE CHANGE
	 *
	 */
	adapter.on('stateChange', function(id, state)
	{
		adapter.log.silly('State of ' + id + ' has changed ' + JSON.stringify(state) + '.');
		
		const userId = getUserId(id.split('.').slice(2));
		if (userId && state && state.val)
		{
			// parse payload
			parsePayload(userId, state.val);
		}
	});
	
	/*
	 * ADAPTER UNLOAD
	 *
	 */
	adapter.on('unload', function(callback)
	{
		try
		{
			adapter.log.info('Adapter stopped und unloaded.');
			callback();
		}
		catch(err)
		{
			callback();
		}
	});
	
    return adapter;
}

/**
 * Get MQTT instances.
 *
 */
function getMQTTInstances(callback)
{
	adapter.objects.getObjectView('system', 'instance', {startkey: 'system.adapter.mqtt.', endkey: 'system.adapter.mqtt.\u9999'}, (err, instances) =>
	{
		if (instances && instances.rows)
		{
			let result = [];
			instances.rows.forEach(row => {
				result.push({id: row.id.replace('system.adapter.', ''), config: row.value.native.type})
			});
			
			callback(null, result);
		}
		else
			callback('Could not retrieve MQTT instances!');
	});
}

/**
 * Set an attribute of a user.
 *
 */
function setUser(userId, attributes)
{
	// create user
	if (USERS[userId] === undefined)
	{
		adapter.log.debug('New user ' + attributes.userName || userId + ' has been registered.');
		
		attributes.avatar = false;
		USERS[userId] = attributes;
	}
	
	// update user attributes
	else
	{
		for (let key in attributes)
			USERS[userId][key] = attributes[key];
	}
	
	// broadcast avatar
	broadcastAvatar(userId);
	
	// additional attributes
	USERS[userId].lastSeen = Date.now();
	
	// set node
	library.setMultiple(USERS[userId], JSON.parse(JSON.stringify(NODES.users)), {'%id%': USERS[userId].userId, '%name%': USERS[userId].userName});
	
	return USERS[userId];
}

/**
 * Get an user ID.
 *
 */
function getUserId([namespace, ident, userName])
{
	if (namespace && ident && userName)
	{
		const userId = userName.replace(/\s|\./g, '_').toLowerCase();
		
		// update
		setUser(userId, {
			'userConnected': true,
			'namespace': namespace,
			'ident': ident,
			'userName': userName,
			'userId': userId
		});
		
		return userId;
	}
	else
		return false;
}

/**
 *
 *
 */
function broadcastAvatar(userId)
{
	const user = USERS[userId];
	
	if (user.avatar) return false;
	USERS[userId].avatar = true;
	
	// send avatar via MQTT adapter
	adapter.log.debug('Broadcast avatar of user ' + user.userName);
	adapter.sendTo(mqtt, 'sendMessage2Client', {topic: user.namespace + '/' + user.ident + '/' + user.userName + '/info', message: JSON.stringify(AVATARS[userId])});
}

/**
 *
 *
 */
function parsePayload(userId, payload)
{
	// parse payload
	const user = USERS[userId];
	let location;
	try
	{
		location = JSON.parse(payload);
		location.encryption = false;
	}
	catch(err)
	{
		adapter.log.warn('Can not parse payload: ' + payload);
		adapter.log.debug(err);
		return false;
	}
	
	/*
	 * TYPE: encrypted
	 * Apps can optionally encrypt outgoing messages with a shared symmetric key. 
	 * @see https://owntracks.org/booklet/tech/json/#_typeencrypted
	 */
	if (location._type === 'encrypted')
	{
		location = decryptPayload(location.data);
		if (location === false) return false;
	}
	
	// update user
	if (location.tid)
		setUser(userId, {'userTid': location.tid, 'userConnected': true});
	
	// LOG
	adapter.log.debug('Received ' + (location.encryption ? 'encrypted' : 'unencrypted') + ' payload from ' + user.userName + ' (' + user.userId + '): ' + JSON.stringify(location));
	
	
	/*
	 * TYPE: location
	 * This location object describes the location of the device that reported it.
	 * @see https://owntracks.org/booklet/tech/json/#_typelocation
	 */
	if (location._type === 'location')
	{
		library.set({node: 'users.' + user.userId, type: 'channel', role: 'user', description: 'Location data of ' + user.userName});
		library.setMultiple(location, JSON.parse(JSON.stringify(NODES.users)), {'%id%': user.userId, '%name%': user.userName});
	}
	
	/*
	 * TYPE: transition
	 * A transition message is sent, when entering or leaving a previously configured geographical region or BLE Beacon.
	 * @see https://owntracks.org/booklet/tech/json/#_typetransition
	 */
	else if (location._type === 'transition')
	{
		library.set({node: 'users.' + user.userId + '.location', type: 'channel', role: 'location', description: 'Location of ' + user.userName});
		setTransition(userId, location);
		setLocation(userId, location);
	}
	else if (location.inregions !== undefined && inregions.inregions.length)
		;//setTransition(userId, {desc: });
	
	/*
	 * TYPE: waypoint
	 * Waypoints denote specific geographical regions that you want to keep track of.
	 * @see https://owntracks.org/booklet/tech/json/#_typewaypoint
	 */
	else if (location._type === 'waypoint')
	{
		
	}
	
	/*
	 * TYPE: waypoints
	 * The app can export a list of configured waypoints to the endpoint.
	 * @see https://owntracks.org/booklet/tech/json/#_typewaypoints
	 */
	else if (location._type === 'waypoints')
	{
		
	}
	
	/*
	 * TYPE: card
	 * Apps read Card to display a name and icon for a user.
	 * @see https://owntracks.org/booklet/tech/json/#_typecard
	 */
	else if (location._type === 'card')
	{
		
	}
	
	/*
	 * TYPE: cmd
	 * Command sent to device for an action to be performed by the device.
	 * @see https://owntracks.org/booklet/tech/json/#_typecmd
	 */
	else if (location._type === 'cmd')
	{
		// supported by MQTT adapter
	}
	
	/*
	 * TYPE: lwt
	 * A last will and testament is published automatically by the MQTT broker when it loses contact with the app. This typically looks like this:
	 * @see https://owntracks.org/booklet/tech/json/#_typelwt
	 */
	else if (location._type === 'lwt')
		setUser(userId, {'userConnected': false});
}

/**
 *
 *
 */
function decryptPayload(payload)
{
	// no encryption key given
	if (!adapter.config.encryptionKey)
	{
		adapter.log.warn('No encryption key defined in settings! Please go to settings and set a key!');
		return false;
	}
	
	// decrypt
	else
	{
		const cypherText = new Buffer(payload, 'base64');
		const nonce = cypherText.slice(0, 24);
		const key = new Buffer(32);
		
		key.fill(0);
		key.write(library.decode(code, adapter.config.encryptionKey));
		
		// try to encrypt message and catch error in case key is wrong
		let obj = {};
		let cipher = null;
		try
		{
			cipher = sodium.crypto_secretbox_open_easy(cypherText.slice(24), nonce, key, 'text');
			obj = JSON.parse(cipher);
		}
		catch(err)
		{
			adapter.log.warn(err);
			return false;
		}

		obj.encryption = true;
		return obj;
	}
}


/**
 * Reads the transition (entry / leave region) of a user
 *
 */
function setTransition(userId, transition)
{
	// get user
	const user = USERS[userId];
	
	// get location
	const locationId = transition.desc.replace(/\s|\./g, '_').toLowerCase();
	const locationName = transition.desc;
	
	// user has entered location
	if (transition.event === 'enter')
	{
		adapter.log.debug('User ' + user.userName + ' entered location ' + locationName + '.');
		
		// add to history
		if (user['location.history'])
			user['location.history'].push(transition);
		else
			user['location.history'] = [transition];
		
		// update user
		setUser(userId, {location: locationName});
		library.setMultiple(
			{
				'current': locationName,
				'entered': transition.tst,
				'history': JSON.stringify(user['location.history'])
			},
			JSON.parse(JSON.stringify(NODES.userLocation)),
			{'%id%': user.userId, '%name%': user.userName}
		);
	}
	
	// user has left location
	else if (transition.event === 'leave')
	{
		adapter.log.debug('User ' + user.userName + ' left location ' + locationName + '.');
		
		// add to history
		if (user['location.history'])
			user['location.history'].push(transition);
		else
			user['location.history'] = [transition];
		
		// update user
		library.setMultiple(
			{
				'current': '',
				'entered': '',
				'last': user.location,
				'left': transition.tst,
				'history': JSON.stringify(user['location.history'])
			},
			JSON.parse(JSON.stringify(NODES.userLocation)),
			{'%id%': user.userId, '%name%': user.userName}
		);
	}
}


/**
 * Reads the transition (entry / leave region) of a user
 *
 */
function setLocation(userId, transition)
{
	const locationId = transition.desc.replace(/\s|\./g, '_').toLowerCase();
	const locationName = transition.desc;
	
	// get location
	if (LOCATIONS[locationId] === undefined)
		LOCATIONS[locationId] = {'history': [], 'users': []};
	
	let location = LOCATIONS[locationId];
	
	// user has entered location
	if (transition.event === 'enter')
	{
		// add user to lcoation
		location.users += USERS[userId].userName + ', ';
		
		// add to history
		location.history.push(transition);
		
		// update location
		library.setMultiple(
			Object.assign(transition,
			{
				'id': locationId,
				'users': location.users,
				'presence': !!location.users.length,
				'history': JSON.stringify(location.history)
			}),
			JSON.parse(JSON.stringify(NODES.locations)),
			{'%id%': locationId, '%name%': locationName}
		);
	}
	
	// user has left location
	else if (transition.event === 'leave')
	{
		// add user to lcoation
		adapter.log.debug(JSON.stringify(location))
		location.users = location.users.replace(USERS[userId].userName+', ', '').replace(USERS[userId].userName, '');
		
		// add to history
		location.history.push(transition);
		
		// update location
		library.setMultiple(
			Object.assign(transition,
			{
				'id': locationId,
				'users': location.users,
				'presence': !!location.users.length,
				'history': JSON.stringify(location.history)
			}),
			JSON.parse(JSON.stringify(NODES.locations)),
			{'%id%': locationId, '%name%': locationName}
		);
	}
}


/*
 * COMPACT MODE
 * If started as allInOne/compact mode => return function to create instance
 *
 */
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    startAdapter(); // or start the instance directly
}
