![Logo](admin/owntracks.png)
# ioBroker.owntracks
[OwnTracks](https://owntracks.org/) allows you to keep track of your own location. You can build your private location diary or share it with your family and friends. OwnTracks is open-source and uses open protocols for communication so you can be sure your data stays secure and private. You may find the respective smartphone apps in the [Apple App Store (iOS)](https://itunes.apple.com/us/app/mqttitude/id692424691?mt=8) or in the [Google Play Store (Android)](https://play.google.com/store/apps/details?id=org.owntracks.android).

![Number of Installations](http://iobroker.live/badges/owntracks-installed.svg)
![Stable version](http://iobroker.live/badges/owntracks-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.owntracks.svg)](https://www.npmjs.com/package/iobroker.owntracks)
[![Travis CI](https://travis-ci.org/iobroker-community-adapters/ioBroker.owntracks.svg?branch=master)](https://travis-ci.org/iobroker-community-adapters/ioBroker.owntracks)
[![Downloads](https://img.shields.io/npm/dm/iobroker.owntracks.svg)](https://www.npmjs.com/package/iobroker.owntracks)

[![NPM](https://nodei.co/npm/iobroker.owntracks.png?downloads=true)](https://nodei.co/npm/iobroker.owntracks/)


**Table of contents**
1. [Setup instructions](#setup-instructions)
   1. [using MQTT server](#)
   2. [using MQTT client](#)
2. [Channels & States](#channels--states)
3. [Changelog](#changelog)
4. [Licence](#license)


## Setup instructions
You have to setup ioBroker.owntracks in connection with the [MQTT adapter](https://github.com/ioBroker/ioBroker.mqtt), which will be installed as a dependency. The MQTT adapters may be setup as either a MQTT server or as a MQTT client.

The following tables shows a comparision:

| Method | Advantages / Disadvantages |
| ------ | ------------- |
| MQTT server | + fully encrypted payload possible<br>- setup of an [dynamics DNS (DynDNS)](https://en.wikipedia.org/wiki/Dynamic_DNS) required<br>- open Port in your router configuration necessary for communication ([read more here](https://owntracks.org/booklet/guide/broker/#firewall)) |
| MQTT client | + fully encrypted payload possible<br>- usage of an Internet MQTT means all traffic is routed through an unknown provider ([read more here](https://owntracks.org/booklet/guide/scenarios/#mqtt-mode))<br>- support for TLS only possible if available at the respective provider |

**IMPORTANT NOTE:** The states within ioBroker will be generated when the specific payload is received! This means the locations in ioBroker will be generated **the first time the user leaves or enters the location**.
Below you will see the target structure

![Settings](img/structure.png)


### General configuration (using either MQTT server or client)

#### Icon settings (within the ioBroker.owntracks adapter)
You can define for every user an icon. Just upload per drag&drop or with mouse click you image. It will be automatically scaled to 64x64.
__The name must be equal to DeviceID in OwnTracks app.__

#### Regions configuration
To setup locations within the owntracks adapter, you have to create regions in the owntracks Android / iOS app.
To do so, go to "Regions" in the drawer

![Settings](img/regions1.jpg)

Create a new region by clicking the plus (+) in the top right corner

![Settings](img/regions2.jpg)

Use the location button in the top right corner to retrieve current location or type them in Latitude and Longitude yourself. Furthermore, specify a radius for the location. If you share the location, your Friends (see in the drawer of the Android / iOS app) get a notification when you enter / leave a location. 

![Settings](img/regions3.jpg)


### Connection configuration (using MQTT server)
You have to complete the following steps in order to setup ioBroker.owntracks via MQTT server:
1. Setup a DynDNS pointing to your IP address as well as open a port in your router
2. Configure MQTT adapter as server with the respective port
3. Configure all clients with the server settings

#### 1. Setup DynDNS and port
tbd

#### 2. Configure MQTT adapter

#### 3. Configure all clients

The following preferences have to be set in the Android / iOS app:

| Setting | Configuration |
| ------- | ------------- |
| Connection/Mode | MQTT private |
| Connection/Host/Host | IP address of your system or DynDNS domain |
| Connection/Host/Port | 1883 or your port on your router |
| Connection/Host/WebSockets | false |
| Connection/Identification/Username | iobroker |
| Connection/Identification/Password | from adapter settings |
| Connection/Identification/DeviceID | Name of device or person |
| Connection/Identification/TrackerID | Short name of user (up to 2 letters) to write it on map. |
| Connection/Security/TLS | off |
| Advanced/Encryption Key | optional, but recommended: Add passphrase for encryption |

Please verify owntracks is connected to iobroker instance via the "Status" entry in the drawer:

![Settings](img/connection.jpg)


### Connection configuration (using MQTT client)
tbd


## Changelog

### 1.0.0-beta.1 (2019-05-01)
Refactored entire code and removed all MQTT package dependencies (to avoid / fix security issues and reduce complexity). Thus, added [MQTT adapter as dependency](https://github.com/ioBroker/ioBroker.mqtt) to manage all MQTT communication.
This major changes comes with the following advantages:
- use both MQTT server as well as MQTT client (to use Internet MQTT server, such as [CloudMQTT](https://www.cloudmqtt.com/)) functionality (this adapter subscribes to foreign states of MQTT adapter)
- user avatars available in both server and client variant
- support TLS and websockets


## License
The MIT License (MIT)

Copyright (c) 2019 Zefau <zefau@mailbox.org>

Copyright (c) 2016-2019 bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
