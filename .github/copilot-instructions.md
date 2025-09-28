# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context

### OwnTracks Location Tracking Adapter

- **Adapter Name**: `owntracks`
- **Primary Function**: Location tracking and geofencing for mobile devices using the OwnTracks app
- **Key Technologies**: MQTT server, location data processing, user presence detection, region management
- **Target Platform**: OwnTracks mobile app (iOS/Android)
- **Data Sources**: GPS coordinates, battery level, location regions, transition events (enter/leave)
- **Communication**: MQTT protocol on configurable port (default 1883), optional encryption support

### Key Features and Components

#### MQTT Server Management
- Runs internal MQTT server for receiving location data from OwnTracks devices
- Handles user authentication and connection management
- Supports both plaintext and encrypted communication with libsodium-wrappers
- Configurable bind address and port settings

#### Location Data Processing
- Processes incoming location payloads with coordinates (latitude/longitude)
- Tracks user transitions between regions (enter/leave events)
- Maintains location history and current status
- Calculates user presence in defined regions

#### User and Device Management
- Creates dynamic state trees for each user/device
- Manages user-specific avatars and device icons
- Tracks device battery levels and connection status
- Supports multiple users and devices per installation

#### Region and Geofencing
- Defines location regions for presence detection
- Tracks user entry/exit from regions
- Maintains regional presence indicators
- Historical tracking of location transitions

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Add your validation logic here
                        resolve();
                        
                    } catch (err) {
                        console.error('❌ Integration test failed:', err);
                        reject(err);
                    }
                });
            }).timeout(60000);
        });
    }
});
```

#### OwnTracks-Specific Testing Patterns

For OwnTracks adapter integration tests, include:

```javascript
// Mock MQTT message for location update
const mockLocationMessage = {
    _type: 'location',
    tid: 'test',
    lat: 52.520008,
    lon: 13.404954,
    batt: 85,
    acc: 10,
    tst: Math.floor(Date.now() / 1000)
};

// Mock region transition message
const mockTransitionMessage = {
    _type: 'transition',
    tid: 'test',
    event: 'enter',
    desc: 'Home',
    lat: 52.520008,
    lon: 13.404954,
    tst: Math.floor(Date.now() / 1000)
};

// Test MQTT server functionality
it('should process MQTT location messages', async () => {
    // Send mock location data to adapter
    // Verify states are created and updated correctly
    // Check user presence and location tracking
});
```

### Testing Strategies
- Test MQTT server initialization and connection handling
- Mock OwnTracks app messages for various scenarios
- Validate location data parsing and state creation
- Test region transition detection and presence updates
- Verify encryption/decryption when enabled
- Test error handling for malformed MQTT messages

## Development

### Core ioBroker Adapter Structure

Every ioBroker adapter should follow this pattern:

```javascript
const utils = require('@iobroker/adapter-core');

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: adapterName
    });

    const adapter = new utils.Adapter(options);

    adapter.on('ready', main);
    adapter.on('unload', callback => {
        // Clean up resources
        callback();
    });

    return adapter;
}

async function main() {
    // Main adapter logic
    adapter.log.info('Adapter started');
    
    // Connect to your service/device
    // Setup event handlers
    // Create initial states
}
```

### State Management
- Use `adapter.getState()` and `adapter.setState()` for state operations
- Define states in io-package.json or create them dynamically
- Use appropriate common.type (boolean, number, string) and common.role
- Set proper common.read/write permissions

### Configuration Handling
- Adapter configuration is available in `adapter.config` 
- Validate configuration values in main() function
- Use native configuration from io-package.json for default values
- Handle configuration changes appropriately

### Logging Best Practices
- Use appropriate log levels: error, warn, info, debug
- Include relevant context in log messages
- Avoid logging sensitive information (passwords, tokens)
- Use structured logging for better debugging

### Error Handling
```javascript
try {
    // Potentially failing operation
} catch (error) {
    adapter.log.error(`Operation failed: ${error.message}`);
    // Handle gracefully, don't crash adapter
}
```

### Lifecycle Management
```javascript
adapter.on('unload', callback => {
  try {
    // Close connections
    if (server) {
        server.destroy();
        server = null;
    }
    
    // Clear timers
    if (connectionTimer) {
      clearTimeout(connectionTimer);
      connectionTimer = undefined;
    }
    // Close connections, clean up resources
    callback();
  } catch (e) {
    callback();
  }
}
```

### OwnTracks Adapter-Specific Patterns

#### MQTT Server Setup
```javascript
const createStreamServer = require('create-stream-server');
const mqtt = require('mqtt-connection');

function setupMQTTServer() {
    const server = createStreamServer(adapter.config.port || 1883, {
        // Server configuration
    });
    
    server.on('client', (client) => {
        const conn = mqtt(client);
        
        conn.on('connect', (packet) => {
            // Handle client connection
            adapter.log.debug(`Client ${packet.clientId} connected`);
        });
        
        conn.on('publish', (packet) => {
            // Process location data from OwnTracks
            processLocationMessage(packet.payload);
        });
    });
}
```

#### Location Data Processing
```javascript
function processLocationMessage(payload) {
    try {
        const data = JSON.parse(payload);
        
        if (data._type === 'location') {
            updateUserLocation(data);
        } else if (data._type === 'transition') {
            handleRegionTransition(data);
        }
    } catch (error) {
        adapter.log.warn(`Invalid message format: ${error.message}`);
    }
}

function updateUserLocation(data) {
    const userId = data.tid || 'unknown';
    
    // Create/update user states
    adapter.setState(`users.${userId}.latitude`, data.lat, true);
    adapter.setState(`users.${userId}.longitude`, data.lon, true);
    adapter.setState(`users.${userId}.battery`, data.batt, true);
    adapter.setState(`users.${userId}.timestamp`, data.tst, true);
}
```

#### Dynamic State Creation
```javascript
function createUserStates(userId) {
    const states = {
        [`users.${userId}.latitude`]: {
            type: 'state',
            common: {
                name: `Latitude for ${userId}`,
                type: 'number',
                role: 'value.gps.latitude',
                read: true,
                write: false
            },
            native: {}
        }
        // Add more states as needed
    };
    
    Object.keys(states).forEach(async (id) => {
        await adapter.setObjectNotExistsAsync(id, states[id]);
    });
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### OwnTracks Testing Considerations
- MQTT server testing requires network port access
- Mock OwnTracks app behavior with predefined message sequences
- Test both encrypted and unencrypted communication modes
- Validate proper cleanup of MQTT connections and timers
- Test behavior with multiple concurrent clients

## JSON Configuration Management

### io-package.json Structure
This file defines adapter metadata and configuration:

```json
{
  "common": {
    "name": "owntracks",
    "version": "1.1.0",
    "titleLang": { "en": "OwnTracks" },
    "desc": { "en": "Location tracking adapter" },
    "type": "geoposition",
    "mode": "daemon",
    "platform": "Javascript/Node.js",
    "authors": ["author@example.com"],
    "dependencies": [{"js-controller": ">=5.0.19"}]
  },
  "native": {
    "port": 1883,
    "user": "iobroker",
    "pass": "",
    "bind": "0.0.0.0",
    "secure": false,
    "pictures": []
  }
}
```

### Configuration Best Practices
- Define sensible defaults in native section
- Use titleLang and desc for multi-language support
- Specify minimum js-controller version in dependencies
- Set appropriate adapter type (geoposition for location adapters)
- Include all configuration parameters used by the adapter

### Instance Objects
Define common state structures in instanceObjects:

```json
"instanceObjects": [
    {
        "_id": "users",
        "type": "channel",
        "common": {
            "role": "users",
            "name": "List of users"
        }
    },
    {
        "_id": "locations", 
        "type": "channel",
        "common": {
            "role": "locations",
            "name": "List of locations"
        }
    }
]
```