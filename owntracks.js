'use strict';
const adapterName = require('./io-package.json').common.name;
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const crypto = require('crypto');


/*
 * internal libraries
 */
const Library = require(__dirname + '/lib/library.js');
const Encryption = require(__dirname + '/lib/encryption.js');

const _NODES = require('./_NODES.js');
const _CIPHER = 'Zgfr56gFe87jJOM';

/*
 * variables initiation
 */
let adapter;
let library, encryption;
let unloaded, mqtt;
let USERS = {}, LOCATIONS = {}, AVATARS = {}, GEOFENCES = {};


/*
 * ADAPTER
 *
 */
function startAdapter(options) {
	options = options || {};
	adapter = new utils.Adapter({ ...options, name: adapterName });
	
	/*
     * ADAPTER READY
     *
     */
	adapter.on('ready', function() {
		unloaded = false;
		library = new Library(adapter, { 'nodes': _NODES, 'updatesInLog': adapter.config.debug || false });
		encryption = new Encryption(adapter);
		
		// Check Node.js Version
		let version = parseInt(process.version.substr(1, process.version.indexOf('.')-1));
		if (version <= 6) {
			return library.terminate('This Adapter is not compatible with your Node.js Version ' + process.version + ' (must be >= Node.js v7).', true);
		}
		
		
		// MQTT not selected
		if (!adapter.config.mqtt) {
			return library.terminate('Select a MQTT instance in ioBroker.owntracks settings!');
		}
		else {
			mqtt = 'mqtt.' + adapter.config.mqtt;
		}
		
		
		// warn about missing encryption key
		if (!adapter.config.encryptionKey) {
			adapter.log.warn('No encryption key specified in settings! It is highly recommended to encrypt communication. See https://github.com/iobroker-community-adapters/ioBroker.owntracks#iobrokerowntracks for more information.');
		}
		else {
			adapter.config.encryptionKey = library.decode(_CIPHER, adapter.config.encryptionKey);
		}
		
		// get locations from config
		LOCATIONS = adapter.config.locations;
		
		// get avatars from config
		adapter.config.pictures.forEach(avatar => {
			// verify content
			if (!avatar.name) {
				return;
			}
			
			// avatar
			let userId = avatar.name.replace(/\s|\./g, '_').toLowerCase();
			AVATARS[userId] = {
				'broadcast': false,
				'_type': 'card',
				'name': avatar.name,
				'face': avatar.base64 ? avatar.base64.substr(avatar.base64.indexOf(',')+1) : undefined
			};
		});
		
		// retrieve all values from states
		adapter.getStates(adapterName + '.' + adapter.instance + '.*', (err, states) => {
			library.set(Library.CONNECTION, true);
			
			// set current states from objects
			for (let state in states) {
				library.setDeviceState(state.replace(adapterName + '.' + adapter.instance + '.', ''), states[state] && states[state].val);
			}
			
			// subscribe to states of MQTT adapter
			// @see https://owntracks.org/booklet/tech/json/#topics
			try {
				adapter.subscribeForeignStates(mqtt + '.*');
			}
			catch(err) {
				adapter.log.warn(err);
			}
		});
	});
	
	/*
	 * HANDLE MESSAGES
	 *
	 */
	adapter.on('message', function(msg) {
		adapter.log.debug('Message: ' + JSON.stringify(msg));
		
		switch(msg.command) {
		case 'getMQTTInstances':
			library.getAdapterInstances('mqtt', function(err, instances) {
				if (err) {
					library.msg(msg.from, msg.command, { 'result': false, 'error': err }, msg.callback);
				}
				else {
					library.msg(msg.from, msg.command, { 'result': true, 'instances': instances }, msg.callback);
				}
			});
			break;
		}
	});

	/*
	 * STATE CHANGE
	 *
	 */
	adapter.on('stateChange', function(id, state) {
		adapter.log.silly('State of ' + id + ' has changed ' + JSON.stringify(state) + '.'); // output also given by MQTT adapter
		
		// get current user
		let params = id.split('.').slice(2,5);
		if (params.length >= 3) {
			
			// get user details
			let user = {
				'userId': params[2].replace(/\s|\./g, '_').toLowerCase(),
				'userName': params[2],
				'userIdent': params.join('/'),
				'tst': Math.floor(Date.now()/1000),
				'userConnected': true
			};
			
			if (user.userId && state && state.val) {
				
				// attach user info globally
				user.reconnected = USERS[user.userId] && USERS[user.userId].userConnected === false;
				USERS[user.userId] = { ...USERS[user.userId] || {}, ...user };
				
				// disconnect user on inactivity
				if (USERS[user.userId].disconnect) {
					clearTimeout(USERS[user.userId].disconnect);
				}
				
				USERS[user.userId].disconnect = setTimeout(() => {
					
					adapter.log.info('User ' + user.userName + ' disconnected due to inactivity!');
					USERS[user.userId].userConnected = false;
					library.set({ ..._NODES.users.userConnected, 'node': _NODES.users.userConnected.node.replace('%id%', user.userId) }, false);
					
				}, 60*1000); // disconnect user after an hour of inactivity
				
				// process payload
				parsePayload(user, state.val);
			}
		}
	});
	
	/*
	 * ADAPTER UNLOAD
	 *
	 */
	adapter.on('unload', function(callback) {
		try {
			adapter.log.info('Adapter stopped und unloaded.');
			
			unloaded = true;
			let user;
			for (let userId in USERS) {
				user = USERS[userId];
				if (user.disconnect) {
					clearTimeout(user.disconnect);
				}
			}
			
			callback();
		}
		catch(err) {
			callback();
		}
	});
	
	return adapter;
}

/**
 * Parse received payload.
 * In MQTT mode the apps publish to:
 *		owntracks/user/device			with _type=location for location updates, and with _type=lwt
 *		owntracks/user/device/cmd		with _type=cmd for remote commands
 *		owntracks/user/device/event		with _type=transition for enter/leave events
 *		owntracks/user/device/step		to report step counter
 *		owntracks/user/device/beacon	for beacon ranging
 *		owntracks/user/device/dump		for config dumps
 *
 *
 * @param {String}		userId		User emitting the payload
 * @param {Object}		payload		Payload emitted by user
 * @return void
 *
 */
function parsePayload(user, payload) {
	
	// parse payload
	try {
		payload = JSON.parse(payload);
		payload.encryption = false;
	}
	catch(err) {
		adapter.log.warn('Can not parse payload: ' + payload);
		adapter.log.debug(err);
		return false;
	}
	
	/*
	 * TYPE: encrypted
	 * Apps can optionally encrypt outgoing messages with a shared symmetric key. 
	 * @see https://owntracks.org/booklet/tech/json/#_typeencrypted
	 */
	if (payload._type === 'encrypted') {
		// no encryption key given
		if (!adapter.config.encryptionKey) {
			adapter.log.warn('Received encrypted payload, but no encryption key defined in settings! Please go to settings and set a key!');
			return false;
		}
		
		// decrypt
		payload = decryptPayload(payload.data, adapter.config.encryptionKey);
		
		// decryption failed
		if (payload === false) {
			return false;
		}
	}
	
	adapter.log.debug('Received ' + (payload.encryption ? 'encrypted' : 'unencrypted') + ' payload from ' + user.userName + ' (' + user.userId + '): ' + JSON.stringify(payload));
	
	
	/*
	 * TYPE: location
	 * This location object describes the location of the device that reported it.
	 * @see https://owntracks.org/booklet/tech/json/#_typelocation
	 */
	if (payload._type === 'location') {
		
		// brodastcast locations (only on user connection)
		if (USERS[user.userId].locations === undefined || USERS[user.userId].reconnected === true) {
			USERS[user.userId].locations = true;
			broadcastLocations(adapter.config.locations, user);
		}
		
		// broadcast avatar
		if (AVATARS[user.userId]) {
			adapter.setForeignObject(
				mqtt + '.' + user.userIdent.replace(RegExp('/', 'g'), '.') + '.info', 
				{
					'type': 'state',
					'common': {
						'name': user.userIdent + '/info',
						'type': 'state',
						'role': 'variable'
					},
					native: {}
				},
				function(err, obj) {
					if (obj !== undefined) {
						adapter.setForeignState(obj.id, {
							'val': JSON.stringify(adapter.config.encryptionKey ? { '_type': 'encrypted', 'data': encryption.encrypt(adapter.config.encryptionKey, JSON.stringify(AVATARS[user.userId])) } : AVATARS[user.userId]),
							'ack': false
						});
					}
				}
			);
		}
		
		// channel
		library.set({ 'node': 'users.' + user.userId, 'type': 'channel', 'role': 'user', 'description': 'Location data of ' + user.userName });
		
		// datapoints
		library.setMultiple(JSON.parse(JSON.stringify(_NODES.users)), { ...payload, ...user }, { 'placeholders': { '%id%': user.userId, '%name%': user.userName }});
	}
	
	/*
	 * TYPE: transition
	 * A transition message is sent, when entering or leaving a previously configured geographical region or BLE Beacon.
	 * @see https://owntracks.org/booklet/tech/json/#_typetransition
	 */
	else if (payload._type === 'transition') {
		// channel
		library.set({ 'node': 'users.' + user.userId + '.location', 'type': 'channel', 'role': 'location', 'description': 'Location of ' + user.userName });
		
		// get location
		payload.locationId = payload.desc.replace(/\s|\./g, '_').toLowerCase();
		payload.locationName = payload.desc;
		delete payload.desc;
		
		// update user history
		let userHistory = JSON.parse(library.getDeviceState('users.' + user.userId + '.location.history') || '[]');
		userHistory.push(payload);
		
		// update location user & history
		let locationUsers = library.getDeviceState('locations.' + payload.locationId + '.users') || '';
		let locationHistory = JSON.parse(library.getDeviceState('locations.' + payload.locationId + '.history') || '[]');
		locationHistory.push(payload);
		
		// user has entered location
		if (payload.event === 'enter') {
			adapter.log.info('User ' + user.userName + ' entered location ' + payload.locationName + '.');
			
			// set geofence active
			payload.geofence = true;
			if (GEOFENCES[user.userId]) {
				clearTimeout(GEOFENCES[user.userId]);
			}
			
			GEOFENCES[user.userId] = setTimeout(
				() => {
					library.set({ ..._NODES.locations.geofence, 'node': _NODES.locations.geofence.node.replace('%id%', payload.locationId) }, false);
					library.set({ ..._NODES.users.geofence, 'node': _NODES.users.geofence.node.replace('%id%', user.userId) }, false);
				},
				(adapter.config.geofence || 15)*60*1000
			);
			
			// update user
			library.setMultiple(
				JSON.parse(JSON.stringify(_NODES.userLocation)),
				{
					'geofence': payload.geofence,
					'enteredLast': payload.locationName,
					'entered': payload.tst,
					'history': JSON.stringify(userHistory)
				},
				{ 'placeholders': { '%id%': user.userId, '%name%': user.userName }}
			);
			
			// update location
			locationUsers = locationUsers.indexOf(user.userName) === -1 ? locationUsers + user.userName + ',' : locationUsers;
		}
		
		// user has left location
		else if (payload.event === 'leave') {
			adapter.log.info('User ' + user.userName + ' left location ' + payload.locationName + '.');
			
			// set geofence inactive
			payload.geofence = false;
			
			// update user
			library.setMultiple(
				JSON.parse(JSON.stringify(_NODES.userLocation)),
				{
					'geofence': payload.geofence,
					'enteredLast': '',
					'entered': '',
					'leftLast': payload.locationName,
					'left': payload.tst,
					'history': JSON.stringify(userHistory)
				},
				{ 'placeholders': { '%id%': user.userId, '%name%': user.userName }}
			);
			
			// update location
			locationUsers = locationUsers.replace(RegExp(user.userName + ',', 'gi'), '');
		}
			
		// update location
		// channel
		library.set({ 'node': 'locations.' + payload.locationId, 'type': 'channel', 'role': 'location', 'description': 'Location data of ' + payload.locationName });
		
		// datapoints
		library.setMultiple(
			JSON.parse(JSON.stringify(_NODES.locations)),
			{
				...payload,
				'users': locationUsers,
				'presence': locationUsers.indexOf(',') > -1,
				'history': JSON.stringify(locationHistory)
			},
			{ 'placeholders': { '%id%': payload.locationId, '%name%': payload.locationName }}
		);
	}
	
	/*
	 * TYPE: waypoint
	 * Waypoints denote specific geographical regions that you want to keep track of.
	 * @see https://owntracks.org/booklet/tech/json/#_typewaypoint
	 */
	else if (payload._type === 'waypoint') {
		
		/*
		 * This will cause recursion together with functionality `waypoints` and `setWaypoints`
		 *
		 *
		 
		if (adapter.config.allowClientsToDefineRegions && (!adapter.config.allowClientsToDefineRegionsWhitelist || (adapter.config.allowClientsToDefineRegionsWhitelist.split(',').indexOf(user.userId) > -1))) {
			delete payload.encryption;
			addLocations([payload]).then(locations => broadcastLocations(locations)).catch(() => {});
		}
		*/
	}
	
	/*
	 * TYPE: waypoints
	 * The app can export a list of configured waypoints to the endpoint.
	 * @see https://owntracks.org/booklet/tech/json/#_typewaypoints
	 */
	else if (payload._type === 'waypoints') {
		
		if (adapter.config.allowClientsToDefineRegions && (!adapter.config.allowClientsToDefineRegionsWhitelist || (adapter.config.allowClientsToDefineRegionsWhitelist.split(',').indexOf(user.userId) > -1))) {
			addLocations(payload.waypoints || []).then(locations => broadcastLocations(locations)).catch(() => {});
		}
	}
	
	/*
	 * TYPE: card
	 * Apps read Card to display a name and icon for a user.
	 * @see https://owntracks.org/booklet/tech/json/#_typecard
	 */
	else if (payload._type === 'card') {
		// not required
		//adapter.log.debug('Requested type: CARD');
	}
	
	/*
	 * TYPE: cmd
	 * Command sent to device for an action to be performed by the device.
	 * @see https://owntracks.org/booklet/tech/json/#_typecmd
	 */
	else if (payload._type === 'cmd') {
		// supported by MQTT adapter, thus not required
		//adapter.log.debug('Requested type: CMD');
	}
	
	/*
	 * TYPE: lwt
	 * A last will and testament is published automatically by the MQTT broker when it loses contact with the app. This typically looks like this:
	 * @see https://owntracks.org/booklet/tech/json/#_typelwt
	 */
	else if (payload._type === 'lwt') {
		AVATARS[user.userId].broadcast = false;
		payload.userConnected = false;
		library.setMultiple(JSON.parse(JSON.stringify(_NODES.users)), payload, { 'placeholders': { '%id%': user.userId, '%name%': user.userName }});
	}
	
	library.set(Library.CONNECTION, true);
}


/**
 * Broadcast locations to users.
 * @see https://owntracks.org/booklet/features/remoteconfig/#setwaypoints
 *
 */
function broadcastLocations(locations, user = null) {
	
	if (adapter.config.publishRegionsToClients) {
		adapter.log.info('Broadcasting locations to ' + (user ? 'client ' + user.userName : 'all connected clients') + '...');
		adapter.log.debug(JSON.stringify(LOCATIONS));
		
		for (let userId in user ? { [user.userId]: USERS[user.userId] } : USERS) {
			user = USERS[userId];
			let payload = {
				"_type":"cmd",
				"action":"setWaypoints",
				"waypoints": {
					"waypoints": LOCATIONS,
					"_creator": "ioBroker.owntracks",
					"_type":"waypoints"
				}
			};
			
			adapter.setForeignState(
				mqtt + '.' + user.userIdent.replace(RegExp('/', 'g'), '.') + '.cmd',
				JSON.stringify(adapter.config.encryptionKey ? { '_type': 'encrypted', 'data': encryption.encrypt(adapter.config.encryptionKey, JSON.stringify(payload)) } : payload)
			);
		}
	}
}


/**
 * Adds locations from payload to configuration.
 *
 */
function addLocations(locations) {
	
	return new Promise((resolve, reject) => {
		adapter.getForeignObject('system.adapter.owntracks.' + adapter.instance, (err, obj) => {
			if (err || obj === undefined) {
				return;
			}

			// 
			// @see https://owntracks.org/booklet/features/waypoints/
			obj.native.locations = obj.native.locations || [];
			let hash = crypto.createHash('sha256').update(JSON.stringify(obj.native.locations)).digest('hex');
			
			//
			obj.native.locations = obj.native.locations.map(location => {
				let index = locations.findIndex(newLocation => newLocation.tst == location.tst);
				
				// region is already added, thus update
				if (index > -1) {
					adapter.log.debug('Found and updated location ' + location.desc + ' in configuration!');
					return locations.splice(index, 1).shift();
				}

				// no changes
				adapter.log.debug('Did not update location ' + location.desc + ' in configuration.');
				return location;
			});
			
			// add new locations
			if (locations.length > 0) {
				adapter.log.debug('Added new locations in configuration: ' + locations.map(location => location.desc).join(', '));
				obj.native.locations = [ ...obj.native.locations, ...locations ];
			}
			else {
				adapter.log.debug('No new locations added.');
			}
			
			if (hash != crypto.createHash('sha256').update(JSON.stringify(obj.native.locations)).digest('hex')) {
				adapter.log.debug('Locations: ' + JSON.stringify(obj.native.locations));
				adapter.log.info('Locations updated. Restarting adapter...');
				
				LOCATIONS = obj.native.locations;
				adapter.setForeignObject(obj._id, obj);
				resolve(obj.native.locations);
				return; // https://stackoverflow.com/questions/32536049/do-i-need-to-return-after-early-resolve-reject
			}
			else {
				adapter.log.info('No updates occurred to the locations.');
			}

			reject('No updates occurred to the locations!');
		});
	});
}


/**
 * Decrypts an encrypted payload.
 *
 */
function decryptPayload(payload, encryptionKey) {
	// try to encrypt message and catch error in case key is wrong
	let obj = {};
	let cipher = null;
	try {
		cipher = encryption.decrypt(encryptionKey, payload);
		obj = JSON.parse(cipher);
		obj.encryption = true;
	}
	catch(err) {
		adapter.log.warn(err);
		return false;
	}

	return obj;
}


/*
 * COMPACT MODE
 * If started as allInOne/compact mode => return function to create instance
 *
 */
if (module && module.parent) {
	module.exports = startAdapter;
}
else {
	startAdapter();
} // or start the instance directly
