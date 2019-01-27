'use strict';
const adapterName = require('./io-package.json').common.name;
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils


/*
 * internal libraries
 */
const Library = require(__dirname + '/lib/library.js');
const Nello = require('nello');

/*
 * variables initiation
 */
let adapter;
let library;
let nello;

let LOCATIONS = {};
let NODES = {

	// address
	'address.address': {role: 'text', description: 'Full address of the location'},
	'address.city': {role: 'text', description: 'City of the location'},
	'address.country': {role: 'text', description: 'Country of the location'},
	'address.state': {role: 'text', description: 'State  of the location'},
	'address.street': {role: 'text', description: 'Street with number of the location'},
	'address.streetName': {role: 'text', description: 'Street name of the location'},
	'address.streetNumber': {role: 'text', description: 'Street number of the location'},
	'address.zip': {role: 'text', description: 'ZIP code of the location'},

	// timeWindows
	'timeWindows.enabled': {role: 'indicator', description: 'State whether time window is enabled'},
	'timeWindows.icalObj': {role: 'json', description: 'Object of the calendar data'},
	'timeWindows.icalRaw': {role: 'text', description: 'Text of the calendar data in iCal format'},
	'timeWindows.id': {role: 'id', description: 'ID of the time window'},
	'timeWindows.image': {role: 'disabled', description: '(not in used)'},
	'timeWindows.name': {role: 'text', description: 'Name of the time window'},
	'timeWindows.state': {role: 'indicator', description: 'State'}
};

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
	 * ADAPTER READY
	 *
	 */
	adapter.on('ready', function()
	{
		// check if settings are set
		if (!adapter.config.token_type || !adapter.config.access_token)
		{
			adapter.log.error('Token is missing! Please go to settings and generate a token first!');
			return;
		}

		// check iot state
		if (!adapter.config.iot) adapter.config.iot = 'iot.0.services.custom_nello';

		// check events_max_count
		if (!adapter.config.events_max_count) adapter.config.events_max_count = 100;

		// check SSL settings, if using DynDNS (respectively not using ioBroker.cloud / iot)
		if (adapter.config.iobroker === '' && adapter.config.uri !== '' && adapter.config.secure && (!adapter.config.certPublicVal || !adapter.config.certPrivateVal))
		{
			adapter.log.error('Usage of Secure Connection (HTTPS) has been selected, but either public certificate or private key (or both) is unselected! Please go to settings and select certificates!');
			return;
		}


		// initialize nello class
		nello = new Nello.device(adapter.config.access_token);
		
		/*
		 * Get locations
		 */
		nello.getLocations().then(function(locations)
		{
			// loop through locations
			locations.forEach(function(location)
			{
				adapter.log.info('Updating location: ' + JSON.stringify(location));
				
				// add to locations
				LOCATIONS[location.location_id] = {location_id: location.location_id, address: location.address, timeWindows: {}, action: location.action};
				
				// create location as device in the ioBroker state tree
				adapter.createDevice(location.location_id, {name: location.address.fullAddress}, {}, function()
				{
					// CHANNEL: address
					adapter.createChannel(location.location_id, 'address', {name: 'Address data of the location'}, {}, function()
					{
						for (let key in location.address)
							library.set(Object.assign({node: location.location_id + '.address.' + key}, NODES['address.' + key] || {}), location.address[key]);
					});
					
					// CHANNEL: time windows
					deleteTimeWindow(location.location_id);
					
					adapter.createChannel(location.location_id, 'timeWindows', {name: 'Time Windows of the location'}, {}, function()
					{
						getTimeWindows(location);
						
						if (adapter.config.refresh !== undefined && adapter.config.refresh > 10)
						{
							// regularly update time windows
							setInterval(
								function()
								{
									deleteTimeWindow(location.location_id);
									getTimeWindows(location);
								},
								Math.round(parseInt(adapter.config.refresh)*1000)
							);
						}
					});

					// CHANNEL: events
					if (!adapter.config.uri && !adapter.config.iobroker)
						adapter.log.warn('Can not attach event listener! Please specify ioBroker.cloud / ioBroker.iot URL or external DynDNS URL in adapter settings!');

					else
					{
						adapter.createChannel(location.location_id, 'events', {name: 'Events of the location'}, {}, function()
						{
							// attach listener
							location.action.addWebhook(adapter.config.iobroker ? adapter.config.iobroker : adapter.config.uri, adapter.config.iobroker ? false : adapter.config.secure).then(function(url)
							{
								if (url === false)
									adapter.log.debug('Webhook could NOT be attached!');
									
								else
								{
									adapter.log.debug('Webhook attached on ' + url + '!');
									
									// attach listener to iobroker.cloud / iobroker.iot
									if (adapter.config.iobroker)
									{
										adapter.subscribeForeignStates(adapter.config.iot);
										adapter.log.debug('Subscribed to state ' + adapter.config.iot + '.');
									}

									// attach listener to DynDNS URL
									else if (adapter.config.uri)
									{
										location.action.addListener(url, ['PUT'], {'cert': adapter.config.certPublicVal, 'key': adapter.config.certPrivateVal, 'ca': adapter.config.certChainedVal});
										location.action.on('webhook', function(payload) // or nello.on('webhook', .. )
										{
											setEvent(payload);
										});
									}
								}
							})
							.catch(function(e) {adapter.log.warn(e.message)});
						});
					}

					// create node for the location id
					library.set({node: location.location_id + '.id', description: 'ID of location ' + location.address.streetName, role: 'id'}, location.location_id);

					// create node for last refresh
					library.set({node: location.location_id + '.refreshedTimestamp', description: 'Last update (Timestamp) of location ' + location.address.streetName, role: 'value'}, Math.round(Date.now()/1000));
					library.set({node: location.location_id + '.refreshedDateTime', description: 'Last update (DateTime) of location ' + location.address.streetName, role: 'text'}, library.getDateTime(Date.now()));

					// create button to open the door
					library.set({
							node: location.location_id + '._openDoor',
							description: 'Open door of location ' + location.address.streetName,
							common: {locationId: location.location_id, role: 'button.open.door', type: 'boolean', 'write': true}
						},
						false
					);

					// attach listener
					adapter.subscribeStates(location.location_id + '._openDoor');
				});
			});

			adapter.log.debug('Retrieved locations: '  + JSON.stringify(LOCATIONS));
		})
		.catch(function(e) {adapter.log.warn(e.message)});

	});

	/*
	 * STATE CHANGE
	 *
	 */
	adapter.on('stateChange', function(id, state)
	{
		adapter.log.debug('State of ' + id + ' has changed ' + JSON.stringify(state) + '.');
		if (state === null) state = {ack: true, val: null};

		// event received
		if (id === adapter.config.iot && state.val)
			setEvent(JSON.parse(state.val));

		// door opened
		if (id.indexOf('_openDoor') > -1 && state.ack !== true)
		{
			adapter.getObject(id, function(err, obj)
			{
				let locationId = obj.common.locationId;
				adapter.log.info('Triggered to open door of location ' + LOCATIONS[locationId].address.fullAddress + ' (' + locationId + ').');
				LOCATIONS[locationId].action.openDoor();
			});
		}

		// add time window (when value is not null for example after clearing)
		if (id.indexOf('timeWindows.createTimeWindow') > -1 && state.ack !== true && state.val !== null)
		{
			adapter.getObject(id, function(err, obj)
			{
				let locationId = obj.common.locationId;

				try
				{
					// parsing data for new time window
					let timewindowData = JSON.parse(state.val);

					// Validation if name is present
					if (timewindowData.name === false || typeof timewindowData.name !== 'string')
						throw 'No name for the time window has been provided!';

					// Simple validation of ical
					if (timewindowData.ical === false || typeof timewindowData.ical !== 'string' || (timewindowData.ical.indexOf('BEGIN:VCALENDAR') === -1 || timewindowData.ical.indexOf('END:VCALENDAR') === -1 || timewindowData.ical.indexOf('BEGIN:VEVENT') === -1 || timewindowData.ical.indexOf('END:VEVENT') === -1))
						throw 'Wrong ical data for timewindow provided! Missing BEGIN:VCALENDAR, END:VCALENDAR, BEGIN:VEVENT or END:VEVENT.';

					adapter.log.info('Triggered to create time window of location ' + LOCATIONS[locationId].address.fullAddress + ' (' + locationId + ').');
					LOCATIONS[locationId].action.addTimeWindow(timewindowData).then(function(tw)
					{
						adapter.log.info('Time window with id ' + tw.id +' was created.');
						getTimeWindows(LOCATIONS[locationId]); // refresh timewindows
					})
					.catch(function(e) {adapter.log.warn(e.message)});
				}
				catch(err)
				{
					adapter.log.error(typeof err === 'string' ? err : 'Parsing error for time window data: ' + err.message);
					return; // cancel
				}
				finally
				{
					// clearing createTimeWindow state
					adapter.setState(id, null);
				}
			});
		}

		// delete time window
		if (id.indexOf('deleteTimeWindow') > -1 && state.ack !== true)
		{
			adapter.getObject(id, function(err, obj)
			{
				let locationId = obj.common.locationId;
				let timeWindowId = obj.common.timeWindowId;
				adapter.log.debug('Triggered to delete time window (' + timeWindowId + ') of location ' + LOCATIONS[locationId].address.fullAddress + ' (' + locationId + ').');
				
				LOCATIONS[locationId].action.removeTimeWindow(timeWindowId).then(function(res)
				{
					adapter.log.info('Time window with id ' + timeWindowId +' deleted.');
					deleteTimeWindow(locationId, timeWindowId);
				})
				.catch(function(e) {adapter.log.warn(e.message)});
			});
		}

		// delete all time windows
		if (id.indexOf('deleteAllTimeWindows') > -1 && state.ack !== true)
		{
			adapter.getObject(id, function(err, obj)
			{
				let locationId = obj.common.locationId;
				adapter.log.debug('Triggered to delete all time windows of location ' + LOCATIONS[locationId].address.fullAddress + ' (' + locationId + ').');
				
				LOCATIONS[locationId].action.removeAllTimeWindows().then(function(res)
				{
					adapter.log.info('All time windows have been deleted.');
					deleteTimeWindow(locationId);
				})
				.catch(function(e) {adapter.log.warn(e.message)});
			});
		}
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
			case 'setToken':
				nello = new Nello.auth(msg.message.clientId, msg.message.clientSecret);
				
				nello.retrieveToken().then(function(res)
				{
					let token = JSON.parse(res);
					adapter.log.debug('Generated token using Client ID and Client Secret: ' + JSON.stringify(token.access_token));
					library.msg(msg.from, msg.command, {result: true, token: token}, msg.callback);
				})
				.catch(function(e)
				{
					adapter.log.warn('Failed generating token (' + e.message + ')!');
					library.msg(msg.from, msg.command, {result: false, error: e.message}, msg.callback);
				});
				break;
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
		catch(e)
		{
			callback();
		}
	});
	
	return adapter;	
};


/**
 * Get time windows.
 *
 */
function getTimeWindows(location)
{
	let locationId = location.location_id;
	location.action.getTimeWindows().then(function(tws)
	{
		let locationAdress = location.address.fullAddress;
		adapter.log.debug('Updating time windows of location ' + locationAdress + '.');
		
		// no time windows found
		if (tws.length === 0)
			library.set({node: locationId + '.timeWindows.indexedTimeWindows', description: 'Index of all time windows', role: 'text'}, '');
		
		// loop through time windows
		tws.forEach(function(tw)
		{
			// create states
			library.set({node: locationId + '.timeWindows.' + tw.id, description: 'Time Window: ' + tw.name}, '');

			// update locations and add to index
			LOCATIONS[locationId].timeWindows[tw.id] = tw;
			library.set({node: locationId + '.timeWindows.indexedTimeWindows', description: 'Index of all time windows', role: 'text'}, Object.keys(LOCATIONS[locationId].timeWindows).join(','));

			// add data
			tw.icalRaw = tw.ical._raw;
			delete tw.ical._raw;

			tw.icalObj = JSON.stringify(tw.ical);
			delete tw.ical;

			for (let key in tw)
				if (key !== 'action') library.set(Object.assign({node: locationId + '.timeWindows.' + tw.id + '.' + key}, NODES['timeWindows.' + key] || {}), tw[key]);

			// create button to delete the timewindow
			library.set({
					node: locationId + '.timeWindows.' + tw.id + '.deleteTimeWindow',
					description: 'Delete the time window ' + tw.id + ' of location ' + locationAdress,
					common: {locationId: locationId, timeWindowId: tw.id, role: 'button.delete', type: 'boolean', 'write': true}
				},
				false
			);

			// attach listener
			adapter.subscribeStates(locationId + '.timeWindows.' + tw.id + '.deleteTimeWindow');
		});

		// create object for creating a timewindow
		library.set({
				node: locationId + '.timeWindows.createTimeWindow',
				description: 'Creating a time window for location ' + locationAdress,
				common: {locationId: locationId, role: 'json', type: 'string', 'write': true}
			}
		);

		// attach listener
		adapter.subscribeStates(locationId + '.timeWindows.createTimeWindow');

		// create button to delete all timewindows
		library.set({
				node: locationId + '.timeWindows.deleteAllTimeWindows',
				description: 'Delete all time windows of location ' + locationAdress,
				common: {locationId: locationId, role: 'button.delete', type: 'boolean', 'write': true}
			},
			false
		);

		// attach listener
		adapter.subscribeStates( locationId + '.timeWindows.deleteAllTimeWindows');
	})
	.catch(function(e) {adapter.log.warn(e.message)});
}

/**
 * Delete states of old time windows.
 *
 */
function deleteTimeWindow(locationId, twId)
{
	// remove states
	adapter.getStatesOf(locationId, 'timeWindows', function(err, states)
	{
		for (let d = 0; d < states.length; d++)
			if (twId === undefined || states[d]._id.indexOf(twId) > -1) adapter.delObject(states[d]._id);
	});
	
	// remove time windows from index
	if (twId !== undefined)
		delete LOCATIONS[locationId].timeWindows[twId];
	else
		LOCATIONS[locationId].timeWindows = {};
	
	// refresh time windows
	getTimeWindows(LOCATIONS[locationId]);	
}

/**
 * Add a received event.
 *
 */
function setEvent(res)
{
	if (res === undefined || res.action === undefined || res.action === null || res.data === undefined || res.data === null)
		return false;
	
	adapter.log.debug('LISTENER: ' + JSON.stringify(res) + '...');
	adapter.log.info('Received data from the webhook listener (action -' + res.action + '-).');

	res.data.timestamp = res.data.timestamp != null ? res.data.timestamp : Math.round(Date.now()/1000);
	library.set({node: res.data.location_id + '.events.refreshedTimestamp', description: 'Timestamp of the last event', role: 'value'}, res.data.timestamp);
	library.set({node: res.data.location_id + '.events.refreshedDateTime', description: 'DateTime of the last event', role: 'text'}, library.getDateTime(res.data.timestamp*1000));

	adapter.getState(res.data.location_id + '.events.feed', function(err, state)
	{
		let feed = state != undefined && state !== null && state.val !== '' ? JSON.parse(state.val) : [];
		// Check if eventfeed-count is maxed out
		if (feed.length >= adapter.config.events_max_count)
		{
			// Shorten the array to max length minus one to add the new event
			feed = feed.slice(-(adapter.config.events_max_count - 1));
		}

		library.set({node: res.data.location_id + '.events.feed', description: 'Activity feed / Event history', role: 'json'}, JSON.stringify(feed.concat([res])));
	});
}

/*
 * COMPACT MODE
 * If started as allInOne/compact mode => return function to create instance
 *
 */
if (module && module.parent)
	module.exports = startAdapter;
else
	startAdapter(); // or start the instance directly
