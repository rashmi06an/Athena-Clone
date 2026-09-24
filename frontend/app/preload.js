// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
    registerListenerForTimerTickFromMain: (callback) => {
        // callback is setTimer
        const fn = (event, message) => {
            callback(message);
        }

        ipcRenderer.on('timer', fn);

        return () => {
            ipcRenderer.removeListener('timer', fn);
        }
    },
    startTimerOnMain: () => {
        try {
            return ipcRenderer.invoke('start-timer');
        } catch (error) {
            throw "error";
        }
    },

    // New Preload Functions

    // Functions related to capturing camera snaps of user
    registerListenerForCameraSnapFromMain: (callback) => {
        ipcRenderer.on('camera-shot', callback);

        return () => {
            ipcRenderer.removeListener('camera-shot', callback);
        }
    },

    storeCameraSnapImageOnDisk: (data) => {
        ipcRenderer.invoke('store-camera-snap-image-on-disk', data);
    },

    // Functions related to showing Contest Rules in a new Dialog
    showRules: () => {
        ipcRenderer.send("show-rules");
    },

    // Functions related to capturing screen snapshots
    registerListenerForScreenShotFromMain: (callback) => {
        ipcRenderer.on('screen-shot', callback);
        return () => {
            ipcRenderer.removeListener('screen-shot', callback);
        };
    },

    getDesktopSources: () => {
        return ipcRenderer.invoke('get-desktop-sources');
    },

    storeScreenSnapImageOnDisk: (data) => {
        ipcRenderer.invoke('store-screen-snap-image-on-disk', data);
    },

    // Background apps & application control
    getRunningApps: () => {
        return ipcRenderer.invoke('get-running-apps');
    },
    reloadApp: () => {
        ipcRenderer.send('reload-app');
    },
})
