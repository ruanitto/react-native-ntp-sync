# @ruanitto/react-native-ntp-sync (forked from [@luneo7/react-native-ntp-sync](https://github.com/luneo7/react-native-ntp-sync.git))

React Native compatible implementation of the NTP Client Protocol.

Used to ensure the time used is in sync across distributed systems. The sync is achieved by the following process:

- Fetches the time from an NTP server.
- Adjusts for network latency and transfer time
- Computes the delta between the NTP server and the system clock and stores the delta for later use.
- Uses all the stored deltas to get the average time drift from UTC.
- Allows for specifying multiple NTP servers as backups in case of network errors.
- Ability to get historical details on (un)successful syncs, errors, and raw time values

## Installation

```
npm i @ruanitto/react-native-ntp-sync
```

## React Native Compatibility

`React Native Version >=0.60.0` - [react-native-udp](https://www.npmjs.com/package/react-native-udp#react-native-compatibility) for more information.

## Getting Started

1. Install the module with: `yarn add @ruanitto/react-native-ntp-sync` or `npm install @ruanitto/react-native-ntp-sync`.
2. Install the native required dependency: `yarn add react-native-udp` or `npm install react-native-udp`.
3. Using React Native >= 0.60, on iOS run `pod install` in **ios** directory.

## Usage

Import the module into your codebase

```javascript
import ntpClient from '@ruanitto/react-native-ntp-sync';
```

Create an instance of the clock object passing in the required params. See the options section below for options that can be used.

```javascript
var options = {};

// create a new instance
var clock = (ntp = new ntpSync(options));

// get the current unix timestamp
var currentTime = clock.getTime();

console.log(currentTime);

// manually sync the time
var result = await clock.syncTime();
```

## Options

The client constructor can accept the following options. **all options are optional**

##### Basic Options

- `autoSync` (boolean) : A flag to control if the client will do automatic synchronizatin. Defaults to `true`
- `history` (+int) : The number of delta values that should be maintained and used for calculating your local time drift. Defaults to `10` if not present, zero, or supplied value is not a number. **Supplied value must be > 0**
- `servers` (array of NtpServer) `{ server: string; port: number; }` : The server used to do the NTP synchronization. Defaults to

```
[
      { server: "time.google.com", port: 123 },
      { server: "time.cloudflare.com", port: 123 },
      { server: "time.windows.com", port: 123 },
      { server: "0.pool.ntp.org", port: 123 },
      { server: "1.pool.ntp.org", port: 123 },
]
```

- `syncInterval` (+number) : The time (in milliseconds) between each call to an NTP server to get the latest UTC timestamp. Defaults to 5 minutes
- `startOnline` (boolean) : A flag to control network activity upon clockSync instantiation. Defaults to `true`. (immediate NTP server fetch attempt)
- `syncOnCreation` (boolean) : A flag to control the NTP sync upon instantiation. Defaults to `true`. (immediate NTP server fetch attempt if startOnline is true)
- `syncTimeout` (+number) : The timeout (in milliseconds) that will be used in every NTP syncronization . Defaults to 10 seconds
- `callbackDelta` (delta: NtpDelta) => void : callback function to receive NtpDelta object every online sync.
- `callbackNTPTime` (ntpTime: number) => void : callback function to receive the time (in milliseconds) every online sync.
```javascript
{
  "history": 10,
  "syncOnCreation": false,
  ...
}
```

## Methods

### getIsOnline()

Returns the current `boolean` network status of the clockSync instance. `false` indicates that no network activity will be performed/NTP servers will not be contacted.

### getHistory()

Returns an `Object` of historical details generated as _clockSync_ runs. It includes several fields that can be used to determine the behavior of a running _clockSync_ instance. Each call represents an individual 'snapshot' of the current _clockSync_ instance. History is not updated when instance is _offline_.

#### Fields

- `currentConsecutiveErrorCount` (int) : Count of current string of errors since entering an error state (`isInErrorState === true`). Resets to `0` upon successful sync.
- `currentServer` (object) : Object containing server info of the server that will be used for the next sync. Props are:
  - `server` (string) : the NTP server name
  - `port` (int) : the NTP port
- `deltas` (array&lt;object&gt;) : This array will contain a 'rolling' list of raw time values returned from each successful NTP server sync wrapped in a simple object with the following keys: (**note:** array length is limited to `config.history`; oldest at `index 0`)
  - `dt` (+/- int) : The calculated delta (in ms) between local time and the value returned from NTP.
  - `ntp` (int) : The unix epoch-relative time (in ms) returned from the NTP server. (raw value returned from server) **note**: `ntp + -1(dt) = local time of sync`
- `errors` (array&lt;object&gt;) : This array will contain a 'rolling' list of any errors that have occurred during sync attempts. (**note:** array length is limited to `config.history`; oldest at `index 0`). The object contains typical fields found in JS `Error`s as well as additional information.
  - `name` (string) : JavaScript Error name
  - `message` (string) : JavaScript Error message
  - `server` (object) : The server that encountered the sync error. Same keys as `currentServer` object. (possibly different values)
  - `stack` (string) : JavaScript Error stack trace (if available)
  - `time` (int) : The **local** unix epoch-relative timestamp when error was encountered (in ms)
- `isInErrorState` (boolean) : Flag indicating if the last attempted sync was an error (`true`) Resets to `false` upon successful sync.
- `lastSyncTime` (int) : The **local** unix epoch-relative timestamp of last successful sync (in ms)
- `lastNtpTime` (int) : The **NTP** unix epoch-relative timestamp of the last successful sync (raw value returned from server)
- `lastError` (object) : The error info of the last sync error that was encountered. Object keys are same as objects in the `errors` array.
- `lifetimeErrorCount` (int) : A running total of all errors encountered since _clockSync_ instance was created.
- `maxConsecutiveErrorCount` (int) : Greatest number of errors in a single error state (before a successful sync).

### getTime()

Returns unix timestamp based on delta values between server and your local time. This is the time that can be used instead of `new Date().getTime()`

### setOnline(boolean)

Sets the current (per-instance) network status. Passing an argument of `true` (if the current status is `false`) will cause the instance to immediately attempt an NTP fetch, and resume the internal update timer at a frequency determined by the `syncDelay` config parameter (or its default). Conversely, passing `false` (when current is `true`) immediately stops the internal timer and prevents any further network activity. **NOTE:** Calling this method with an argument that matches the instance's current network state results in a no-op.

#### Offline behavior

When set to _offline_, calls to `getTime()` will return the current device time adjusted by whatever values are currently in the history. (or no adjustment if the history is empty/NTP has never been fetched)

Calls to `syncTime()` are effectively a no-op in offline mode. No NTP fetch will be performed, and no updates to the local time history will be made (to prevent polluting the running average drift).

#### Example

When dealing with mobile development, it is sometimes necessary to respond to changes in network availability. `setOnline` provides a convenient 'hook' to do so, preventing unnecessary errors and timeouts.

React Native allows for watching device network status. Which can be used with `setOnline` like so:

```javascript
import ntpSync from '@ruanitto/react-native-ntp-sync';
import { NetInfo } from 'react-native';
// start in offline state
const config = {
  startOnline: false,
};
const clock = new ntpSync(config);
// set initial state
NetInfo.isConnected.fetch().then((isConnected) => {
  clock.setOnline(isConnected);
});
// this handler will receive the device's network status changes
function handleConnectivityChange(isConnected) {
  clock.setOnline(isConnected);
}
// register handler with react-native
NetInfo.isConnected.addEventListener(
  'connectionChange',
  handleConnectivityChange
);
```

**NOTE:** The example above does not account for rapid changes in network state. You may wish to add additional handling to 'de-bounce' such changes. Also, remember to remove the listener and set your clockSync instance to _offline_ when done (un-mounting components, shutting down, etc.)

### syncTime()

An on-demand method that will force a sync with an NTP server.
**NOTE:** You generally do not need to invoke a manual sync since _ntpClient_ automatically runs sync according to the specified `syncInterval` interval (or its default).

### startAutoSync()

An on-demand method that will start auto sync according to the specified `syncInterval` interval (or its default).

### stopAutoSync()

An on-demand method that will stop auto sync according.

## Based On

@jet/react0native-ntp-client is based on [react-native-clock-sync](https://github.com/artem-russkikh/react-native-clock-sync) and [react-native-ntp-client](https://github.com/artem-russkikh/react-native-ntp-client) by [Artem Russkikh](https://github.com/artem-russkikh)

## Dependencies

- [buffer](https://www.npmjs.com/package/buffer)
- [react-native-udp](https://www.npmjs.com/package/react-native-udp)
