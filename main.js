/**
 *
 *
 * You can read here, how REST API could be implementer: https://scotch.io/tutorials/build-a-restful-api-using-node-and-express-4
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils      = require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = utils.adapter('owntracks');
var LE =      require(__dirname + '/lib/letsencrypt.js');

// REST server
var webServer = null;

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        if (webServer) {
            webServer.close();
            webServer = null;
        }
        callback();
    } catch (e) {
        callback();
    }
});


// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function initWebServer(settings) {
    app    = express();

    // install authentication
    app.get('/', function (req, res, next) {
        var b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        var loginPass = new Buffer(b64auth, 'base64').toString().split(':');
        var login     = loginPass[0];
        var password  = loginPass[1];

        // Check in ioBroker user and password
        if (login !== adapter.config.user || password !== adapter.config.pass) {
            adapter.log.error('Wrong user or password: ' + login);
            res.set('WWW-Authenticate', 'Basic realm="nope"');
            res.status(401).send('You shall not pass.');
        } else {
            req.user = login;
            next();
        }
    });

    // REGISTER OUR ROUTES -------------------------------
    // all of our routes will be prefixed with /api
    app.use('/own', function (req, res, next) {
        var b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        var loginPass = new Buffer(b64auth, 'base64').toString().split(':');
        var login     = loginPass[0];
        var password  = loginPass[1];

        // Check in ioBroker user and password
        if (login !== adapter.config.user || password !== adapter.config.pass) {
            adapter.log.error('Wrong user or password: ' + login);
            res.set('WWW-Authenticate', 'Basic realm="nope"');
            res.status(401).send('You shall not pass.');
        } else {
            req.user = login;
            next();
        }
    });

    if (settings.port) {
        if (settings.secure) {
            if (!adapter.config.certificates) {
                adapter.log.error('certificates missing');
                return null;
            }
        }

        webServer = LE.createServer(app, adapter.config, adapter.config.certificates, adapter.config.leConfig, adapter.log);

        adapter.getPort(settings.port, function (port) {
            if (port != settings.port && !adapter.config.findNextPort) {
                adapter.log.error('port ' + settings.port + ' already in use');
                process.exit(1);
            }
            webServer.listen(port, settings.bind, function() {
                adapter.log.info('Server listening on http' + (settings.secure ? 's' : '') + '://' + settings.bind + ':' + port);
            });
        });
    } else {
        adapter.log.error('port missing');
        process.exit(1);
    }
}

function main() {

    // try to load certificates
    if (adapter.config.secure) {
        // Load certificates
        // Load certificates
        adapter.getCertificates(function (err, certificates, leConfig) {
            adapter.config.certificates = certificates;
            adapter.config.leConfig     = leConfig;
            initWebServer(adapter.config);
        });
    } else {
        initWebServer(adapter.config);
    }
}
