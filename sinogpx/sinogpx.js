// ==UserScript==
// @name           sinogpx
// @namespace      sinogpx
// @description    Pobiera ścieżkę historii jako plik GPX
// @version        0.1.0
// @include        https://sinotrack.com/*
// @include        https://*.sinotrack.com/*
// @include        https://*.sinotrack.com/*
// @grant          none
// @run-at         document-start
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. 
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function (){
'use strict';

var doDebug = 3;

//-----------------------------------------------------------

var wnd = undefined;

var engine = new function(){
    this.destroyed = false;
    
    this.findAndInit = function() {
        if (typeof utils.encode === 'function' && typeof utils.md5 === 'function') {
            return true;
        }
        return Object.keys(wnd)
            .filter(k => k.startsWith('_x'))
            .filter(k => this.tryInit(k))
            .length > 0;
    }
    
    this.tryInit = function(rootName) {
        try {
            let root = wnd[rootName];
            
            // broken base64
            let encode = Object.keys(root).filter(p => 
                root[p] != null 
                    && typeof root[p].Encode === "function");
                    
            if (encode.length === 0) {
                return false;
            }

            let md5 = Object.keys(root).filter(p => 
                root[p] != null 
                    && typeof root[p] === "function" 
                    && root[p].toString().indexOf('0123456789ABCDEF') > 0 
                    && root[p]('a') == '0cc175b9c0f1b6a831c399e269772661' ); 

            if (md5.length === 0) {
                return false;
            }

            utils.encode = root[encode[0]].Encode;
            utils.md5 = root[md5[0]];
            log.debug("encode: {}, md5: {} from {}", 
                encode[0], 
                md5[0],
                rootName);
            
            return true;
        } catch (e) {
            log.always('Failed to init: {}', e);
            return false;
        }
    }

    this.init = function() {
        const timer = setInterval(() => {
            if (this.destroyed || this.initUI()) {
                clearInterval(timer)
            }
        }, 1500)
    }

    this.initUI = function() {
        let rootNode = ((dom.getNodesByCss('div.TitleFont').filter(e => e.innerHTML.trim() == "History track") || [])[0] || {}).parentNode;
        if (typeof rootNode === 'undefined') {
            return false;
        }
        log.debug('rootNode: {}', rootNode);
        
        let dlBtn = dom.createElem('button', 
            {'class': 'ivu-btn ivu-btn-secondary ivu-btn-small', 'type': 'button', 'style': 'margin-right: 10px;'}, 
            dom.createElem('span', {}, 'Get GPX'))

        dlBtn.addEventListener('click', this.doDownloadGpx.bind(this));
        rootNode.lastChild.appendChild(dlBtn);
        
        this.rootNode = rootNode;
        this.dlBtn = dlBtn;
        return true;
    }
    
    this.destroy = function() {
        this.destroyed = true
        if (typeof this.dlBtn != 'undefined'){
            this.dlBtn.parentNode.removeChild(this.dlBtn)
            delete this.dlBtn
        }
    }
    
    this.doDownloadGpx = async function(evt) {
        delete this.responseData
        
        this.responseData = await this.downloadRecords();

        if (!Array.isArray(this.responseData)) {
            return false
        }

        delete this.gpxData
        delete this.fileModel
        delete this.gpxXml

        this.gpxData = this.mapDataToGpxModel(this.responseData);
        
        if (typeof this.gpxData !== 'object') {
            return false
        }
        
        this.fileModel = this.prepareGpx(this.gpxData);
        
        let date = this.gpxData.metadata.time
        date = date.replace('.Z', '.000Z')
        date = new Date(Date.parse(date))
        
        let fileName = date.getFullYear() + utils.pad(date.getMonth()+1) + utils.pad(date.getDate()) 
            + '_' + utils.pad(date.getHours()) + utils.pad(date.getMinutes()) + '.gpx'
        
        this.gpxXml = this.serializeXml('gpx', this.fileModel);
        // log.trace('gpx xml: {}', this.gpxXml);
        
        this.startDownload(evt, this.gpxXml, fileName, 'text/xml')
        
        return true
    }
    
    this.startDownload = function(evt, data, filename, type) {
        log.info('Creating DL for filename {}, ev: {}', filename, evt)
        
        let blob = new Blob([data], {type: type})
        let url = URL.createObjectURL(blob)

        let dlink = dom.createElem('a', {
            download: filename,
            href: url
        }, filename)
        dlink.style.display = 'none'
        dlink.addEventListener('click', function (e) {
            log.info('Downloaded...')
        })
        document.body.appendChild(dlink)
        dlink.dispatchEvent(evt)
        setTimeout(function() {
            dlink.remove()
            URL.revokeObjectURL(url)
            delete this.responseData
            delete this.gpxData
            delete this.fileModel
            delete this.gpxXml
        } .bind(this), 150)
        
        /*
        dlink.download = filename
        dlink.href = 'data:' + type + ';charset=utf-8,' + encodeURIComponent(data)
        dlink.textContent = filename
        //dlink.dispatchEvent(evt)
        dlink.click()
        setTimeout(function() {
            dlink.parentNode.removeChild(dlink)
            //URL.revokeObjectURL(url)
        }, 150000)
        /*
        let dlink = dom.createElem('a', {
            download: filename,
            href: 'data:' + type + ';charset=utf-8,' + encodeURIComponent(data)
        }, filename)
        // dlink.style.display = 'none'
        document.body.appendChild(dlink)
        //dlink.click()
        dlink.dispatchEvent(new MouseEvent('click'))
        setTimeout(function() {
            document.body.removeChild(dlink)
        }, 150000)
        */
    }

    this.downloadRecords = async function() {
        let responseData = [];
        
        let payload = this.prepareDownloadGpxPayload();
        if (!payload) {
            alert('No device selected');
            return false
        }
        let pageNo = 1;
        let resp = { };
        const itemsPerPage = 200;
        do {
            resp = { m_arrRecord: [], m_isResultOk: 0 };
            log.info('About to get page no: {}', pageNo);
            let req = this.prepareRequest('Proc_GetTrack', payload, pageNo, itemsPerPage);
            let errMsg = 'Failed to download gpx at page ' + pageNo;
            resp = await this.sendRequest(req).catch(err => alert(errMsg));
            try{
                resp = JSON.parse(resp);
            } catch (ex) {
                log.always('Failed to parse JSON: {}, {}', resp, ex);
                alert(errMsg + ', ' + ex);
                return false;
            }
            if (!this.isResponseOk(resp)) {
                alert(errMsg);
                return false;
            }
            log.info('Got page no: {} with: {} records', pageNo, resp.m_arrRecord.length);
            if (resp.m_arrRecord.length == 0 && pageNo === 1) {
                alert('No data for this time range');
                return false;
            }
            resp = this.transformResponseTab(resp);
            responseData = responseData.concat(resp.m_arrRecord);
            pageNo++;
        } while (resp.m_arrRecord.length == itemsPerPage);        
        return responseData;
    }
    
    this.isResponseOk = function(data) {
        return data 
            && data !== null 
            && typeof data === 'object'
            && data.m_isResultOk === 1 
            &&  Array.isArray(data.m_arrField) 
            &&  Array.isArray(data.m_arrRecord)
    }
    
    /**
     * data is an array of objects containing data elements:
     * dbLat, dbLon, nTime, nDirection, nSpeed, 
     * nCarState, nTEState, nAlarmState
     * nID, strOther
     */
    this.mapDataToGpxModel = function(data) {

        let sortedData = data.sort((a, b) => {
            a = a.nTime
            b = b.nTime
            return a - b
        })
        
        if (sortedData.length === 0) {
            return false 
        }
        
        log.info('Processing {} elements from {}',
            sortedData.length,
            () => new Date(sortedData[0].nTime * 1000)
        )
        
        let extensions = {
            'sino:data': JSON.stringify(this.prepareRawData(sortedData))
        }

        let wpt = this.prepareCrashData(sortedData)
        let seen = {}
        data = sortedData.filter(elem => {
            if (!this.isValidLocation(elem)) {
                return false;
            }
            let key = '_' + elem.dbLat + '_' + elem.dbLon + '_' + elem.nCarState + '_' + elem.nTEState + '_' + elem.nAlarmState
            return seen.hasOwnProperty(key) ? false : (seen[key] = true)
        });
        seen = undefined;
        
        let getIdFromTrkpt = (trkpt) => trkpt.extensions['sino:ext']['sino:id']

        let trk = [];
        let trkpts = [];
        
        let newTrk = (dt) => { return {
            startDate: new Date(dt * 1000),
            validStartDateSet: false,
            endDate: new Date(dt * 1000),
            name: '',
            desc: null,
            cmt: null,
            trkseg: []
        }};
        
        let firstElem = data[0] || {}
        let lastElem = firstElem
        log.trace("first: {}", firstElem.nID)
        
        let lastTime = firstElem.nTime || 0
        let lastCarState = firstElem.nCarState || 0
        let currTrk = newTrk(lastTime)
        
        let finalizeCurrTrack = function() {
            if (currTrk && trkpts.length > 0) {
                currTrk.name = this.prepareTraceDataRange(currTrk.startDate, currTrk.endDate)
                log.trace("trkpts: {} -> {}", getIdFromTrkpt(trkpts[0]), getIdFromTrkpt(trkpts[trkpts.length-1]))
                currTrk.trkseg.push({
                    trkpt: trkpts
                })
                trkpts = []
                delete currTrk.startDate
                delete currTrk.endDate
                delete currTrk.validStartDateSet
                trk.push(currTrk)
            }
            currTrk = undefined
        } .bind(this)
        
        data.forEach(elem => {
            let prevTime = new Date(lastTime * 1000)
            lastTime = elem.nTime
            let currTime = new Date(lastTime * 1000)
            if (this.isNewTrackSwitch(prevTime,currTime)) {
                log.trace("Split trk by date: {} - {} -> {} - {}", prevTime, lastElem.nID, currTime, elem.nID)
                // zmiana doby
                finalizeCurrTrack()
                currTrk = newTrk(elem.nTime)
            }
            let currCarState = elem.nCarState
            if ((lastCarState&128) !== 0 && (currCarState&128) === 0) {
                log.trace("Split trkseg by carState: {} - {} -> {} - {}", lastCarState, lastElem.nID, currCarState, elem.nID)
                if (trkpts.length > 0) {
                    log.trace("trkpts: {} -> {}", getIdFromTrkpt(trkpts[0]), getIdFromTrkpt(trkpts[trkpts.length-1]))
                    currTrk.trkseg.push({
                        trkpt: trkpts
                    })
                    trkpts = []
                }
            }
            lastCarState = currCarState
            let trkpt = this.mapElem(elem)
            trkpts.push(trkpt)
            if (this.isValidLocation(elem)) {
                if (!currTrk.validStartDateSet) {
                    currTrk.startDate = currTime
                    currTrk.validStartDateSet = true
                }
                currTrk.endDate = currTime
            }
            
            lastElem = elem
        })
        log.trace("last: {}", lastElem.nID)
        finalizeCurrTrack()
        
        let metadata
        if (typeof firstElem.nTime !== 'undefined') {
            let dts = new Date(firstElem.nTime * 1000)
            let dte = new Date(lastElem.nTime * 1000)
            metadata = {
                name: this.prepareTraceDataRange(dts, dte),
                time: dts.toISOString().replace('.000Z', 'Z')
            }
        } else {
            metadata = {
                name: 'Empty track',
                time: new Date(sortedData[0].nTime).toISOString().replace('.000Z', 'Z')
            }
        }
        let result = {
            metadata: metadata,
            wpt: wpt,
            trk: trk,
            extensions: extensions
        };
        
        // gpx
        //   metadata
        //   wpt*
        //   trk*
        //     name
        //     cmt
        //     desc
        //     trkseg*
        //       trkpt*
        
        log.info('Done processing data')
        
        return result
    }
    
    this.prepareRawData = function(sortedData) {
        let rawDataKeys = {}
        sortedData.forEach(elem => Object.keys(elem).forEach(key => rawDataKeys[key] = true))
        let rawData = {
            keys: Object.keys(rawDataKeys),
            data: sortedData.map(elem => {
                let result = []
                Object.keys(rawDataKeys).forEach(key => {
                    result.push(elem[key])
                })
                return result
            })
        }
        return rawData
    }
    
    this.prepareCrashData = function(sortedData) {
        //let seen = {}
        let wpts = sortedData.filter(elem => {
            if ((elem.nCarState&8) === 0 && (elem.nAlarmState&131073) === 0) {
                return false;
            }
            if (!this.isValidLocation(elem)) {
                return false;
            }
            //let key = '_' + elem.dbLat + '_' + elem.dbLon
            //return seen.hasOwnProperty(key) ? false : (seen[key] = true)
            return true
        }).map(elem => {
            let dt = new Date(elem.nTime * 1000)
            let name = 'Unexpected shake on ' + utils.dateToStr(dt) + ' ' + utils.timeToStr(dt)
            let crashWpt = this.mapElem(elem, name, 'transport-accident')
            return crashWpt
        })
        return wpts
    }
    
    this.isNewTrackSwitch = function(dt1, dt2) {
        // TODO: split after 10 minutes of inactivity???
        // split at 4 AM local time
        let ts1 = (((dt1.getTime() - 1000*60*dt1.getTimezoneOffset())/1000/60/60)-4)/24 
        let ts2 = (((dt2.getTime() - 1000*60*dt2.getTimezoneOffset())/1000/60/60)-4)/24 
        return Math.floor(ts1) != Math.floor(ts2)
    }        
    
    this.mapElem = function(elem, name, symbol) {
        let dt = new Date(elem.nTime * 1000)
        let speed =  Math.round(10 * elem.nSpeed / 3.6) / 10
        let nCarStates = this.decodeCarState(elem.nCarState)
        let nTEStates = this.decodeTEState(elem.nTEState)
        let nAlarmStates = this.decodeAlarmState(elem.nAlarmState)
        let others = this.decodeOthers(elem.strOther)
        let ext = {
            'sino:id': elem.nID,
            'sino:carState': nCarStates,
            'sino:teState': nTEStates,
            'sino:alarmState': nAlarmStates
        }
        if (elem.nGSMSignal !== 0) {
            ext['sino:gsmSignal'] = elem.nGSMSignal
        }
        if (elem.nGPSSignal !== 0) {
            ext['sino:gpsSignal'] = elem.nGPSSignal
        }
        if (elem.nFuel !== 0) {
            ext['sino:fuel'] = elem.nFuel
        }
        if (elem.nTemp !== 0) {
            ext['sino:temp'] = elem.nTemp
        }
        if (typeof elem.nMileage !== 'undefined') {
            ext['sino:mileage'] = elem.nMileage
        }
        ext['sino:other'] = others
        return {
            attribs: {
                lat: elem.dbLat,
                lon: elem.dbLon
            },
            time: dt.toISOString().replace('.000Z', 'Z'),
            name: name,
            sym: symbol,
            extensions: {
                'gpxtpx:TrackPointExtension': {
                    'gpxtpx:course': elem.nDirection,
                    'gpxtpx:speed': speed
                },
                'sino:ext': ext,
            }
        }
    }
    
    this.decodeOthers = function(others) {
        if (others === '') {
            return undefined
        }
        let result = []
        String(others).split(';').forEach(elem => {
            elem = elem.split('=')
            let key = elem[0]
            let val = elem[1]
            if (key === 'RecvTime') {
                val = new Date(parseInt(val)*1000).toISOString().replace('.000Z', 'Z')
            } else {
                val = val.split(',')
            }
            let item = {
                attribs: {
                    name: key
                },
                'sino:value': val
            }
            result.push(item)
        })
        return result
    }
    
    this.decodeBitState = function(bits, matrix) {
        let left = bits
        let result = []
        if (bits !== 0) {
            result.push(bits.toString(16))
        }
        for (let i=0; i<matrix.length; ){
            let mask = matrix[i++]
            let desc = matrix[i++]
            if ((bits&mask) === mask) {
                result.push(desc)
            }
            left = left & ~mask
        }
        if (left !== 0 && left !== bits) {
            result.push(left.toString(16))
        }
        return result.length === 0 ? undefined : result
    }
    
    this.decodeCarState = function(nCarState) {
        return this.decodeBitState(nCarState, [
            8, 'Car Shake',
            32, 'Door Open',
            128, 'Engine On',
            2048, 'Lock Open',
            
            65536, 'Left Turn',
            131072, 'Right Turn',
            262144, 'Clutch',
            524288, 'Brake',
            2097152, 'Reverse',
            4194304, 'HI Beam',
            8388608, 'LO Beam',
            1048576, 'Fog Lamp',
            33554432, 'Heater',            
            67108864, 'ABS',
            134217728, 'Retarder',
            268435456, 'Neutral Gear',
            536870912, 'Air Conditioner',
            1073741824, 'Horn',
            2147483648, 'Outline Lamp',

            // for some reason, those values overlap - find out why and how to distinguish them
            // maybe it depends on wheather engine is on/off or car is moving
            512, 'Refuel',
            1024, 'Heavy',
            4096, 'Start Defend',
			131072, 'Sim Card Removed',
			524288, 'Lock Wire Cut Off',
			1048576, 'Lock Wire Pulled Out',
			2097152, 'Lock Wire Inserted',
            4194304, 'Close Lock',
            8388608, 'Open Lock'
        ])
    }
    
    this.decodeTEState = function(nCarState) {
        return this.decodeBitState(nCarState, [
            1, 'GPS Short Circuit',
            2, 'GPS Open Circuit',
            4, 'GPS Fault',
            8, 'Send Stored Data 2',
            16, 'Battery Fault',
            32, 'Network Roam',
            64, 'Send Stored Data',
            64, 'Break',
            128, 'Invalid Position',
            256, 'Camera Fault',
            512, 'TTS Fault',
            1024, 'LCD Fault',
            2048, 'Power Saving - Virtual Position',
            4096, 'Wifi Location',
            8192, 'GSM Location',
            // 0xFF0000 mask - power %
            67108864, 'POI',
            134217728, 'Super Power Saving Mode',
            268435456, 'Multi GSM Location',
            536870912, 'Battery Power',
            1073741824, 'Shutdown',
            2147483648, 'Dormancy'
        ])
    }
    
    this.decodeAlarmState = function(nCarState) {
        return this.decodeBitState(nCarState, [
            1, 'Bump Alarm',
            2, 'Circuit Cutoff',
            4, 'Fuel Cutoff',
            8, 'Main Power Cutoff',
            16, 'Out Fence Alarm',
            32, 'In Fence Alarm',
            64, 'Over Speed Alarm',
            128, 'Urgent Alarm',
            256, 'Tow Alarm',
            512, 'Idling Alarm',
            1024, 'Tired Drive Alarm',
            2048, 'Klaxon Alarm',
            4096, 'Request Info Alarm',
            8192, 'Request Help Alarm',
            16384, 'Hight Voltage Alarm',
            32768, 'Low Voltage Alarm',
            65536, 'Illegal Ignition',
            131072, 'Shock Alarm',
            262144, 'Open Door Alarm',
            524288, 'Ignition Alarm',
            1048576, 'Fuel Streal',
            2097152, 'Temp Low Alarm',
            4194304, 'Temp Hight Alarm',
            8388608, 'Ban Time Move Alarm',
            16777216, 'Park Timeout Alarm',
            33554432, 'Gas Leak Alarm',
            67108864, 'Arrearage Alarm',
            134217728, 'Steal Alarm',
            268435456, 'Custom Alarm 4',
            536870912, 'Custom Alarm 3',
            1073741824, 'Custom Alarm 2',
            2147483648, 'Custom Alarm 1',
        ])
    }

    this.isValidLocation = function (elem) {
        return !(elem.dbLon > 180 || elem.dbLon < -180 || elem.dbLat > 90 || elem.dbLat < -90) 
            && (
                (elem.dbLon != 0 || elem.dbLat != 0) 
                    // 0x80   - InvalidPosition
                    // 0x1000 - WifiLocation
                    && (!!(elem.nTEState & 0x1000) || !(elem.nTEState & 0x80)));
    }
    
    this.prepareTraceDataRange = function(dts, dte) {
        let name = 'Trace from ' + utils.dateToStr(dts) + ' ' + utils.timeToStr(dts) + ' to ';
        if (dts.getYear() === dte.getYear() + dts.getMonth() === dte.getMonth() && dts.getDate() === dte.getDate()){
            name += utils.timeToStr(dte);
        } else {
            name += utils.dateToStr(dte) + ' ' + utils.timeToStr(dte);
        }
        return name
    }
    
    this.transformResponseTab = function(data) {
        let fields = data.m_arrField;
        let arr = data.m_arrRecord;
        data.m_arrRecord = arr.map(e => {
            let result = {};
            let len = e.length;
            for (let i=0; i<len; i++){
                let field = fields[i]
                let v = e[i]
                result[field] = v
                if (field.startsWith('n') && !Number.isNaN(v = parseInt(v))) {
                    result[field] = v
                }
            }
            return result;
        });
        return data;
    }
    
    this.getDateRange = function() {
        let dataRanges = dom.getNodesByCss('input[readonly]', this.rootNode);
        log.debug('dataRanges: {}', dataRanges);
        
        let fromDt = dataRanges[0].value;
        let fromTs = dataRanges[1].value;
        let toDt = dataRanges[2].value;
        let toTs = dataRanges[3].value;
        
        log.info('from: {} {}, to: {} {}', fromDt, fromTs, toDt, toTs);
        
        return [ utils.parseDateTime(fromDt, fromTs), utils.parseDateTime(toDt, toTs) ];
    }
    
    this.getDeviceId = function() {
        // TODO: tu w polu jest nazwa, a nie id -> trzeba mapowanie...
        // return dom.getNodeByCss('input[placeholder="Please select a Device"]', this.rootNode).value;
        return wnd.MGTS.Config.strCurTEID;
    }
    
    this.prepareDownloadGpxPayload = function() {
        let deviceId = this.getDeviceId();
        if (!deviceId) {
            return false
        }
        let dateRange = this.getDateRange();
        let limit = 100000;
        let data = [ deviceId, dateRange[0], dateRange[1], limit ]
            .map(e => "'" + e + "'")
            .join();
        return data;
    }
    
    this.prepareRequest = function(command, data, pageNo, limitPerPage) {
        let req = {
            strAppID: '',
            strUser: utils.myToString(wnd.MGTS.Config.strCurUser),
            nTimeStamp: utils.myToString(new Date().getTime()),
            strRandom: utils.myToString(utils.longRandom()),
            strSign: '',
            strToken: ''
        };
        
        let x = utils.myToString(wnd.MGTS.Config.strServer).toLowerCase();
        // dopóki długość się nie dzieli przez 3, to dołącza znak slash
        x = x.replace('http://', '').replace('https://', '');
        while ((x.length %3) != 0) {
            x += '/';
        }
        req.strAppID = utils.encode(x);
        
        x = command + utils.recordDelimeter 
                + data + utils.recordDelimeter 
                + utils.recordDelimeter ;
        if (typeof limitPerPage == 'number') {
            x += limitPerPage + utils.recordDelimeter;
        }
        if (typeof pageNo == 'number') {
            x += pageNo + utils.recordDelimeter;
        }
                
        x += utils.endDelimeter;
        while ((x.length %3) != 0) {
            x += Math.floor(10 * Math.random()).toString();
        }
        req.strToken = utils.encode(x);
        
       x = req.nTimeStamp + req.strRandom + req.strUser + req.strAppID + req.strToken;
       req.strSign = utils.md5(x);
       
       return req;
    }
    
    this.sendRequest = function(objToSend) {
        let xhr = new XMLHttpRequest();
        let url = wnd.MGTS.Config.strServer + wnd.MGTS.Config.strServerURL;
        xhr.open('POST', url, true);

        //Send the proper header information along with the request
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');

        let result = new Promise( (resolve, reject) => 
            xhr.onreadystatechange = () => {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    if (xhr.status == 200) {
                        resolve(xhr.responseText);
                    } else {
                        log.error('Request send failed: {}', xhr);
                        reject(xhr);
                    }
                }
            }
        );
        
        let data = Object.keys(objToSend).map(p => 
            p + '=' + encodeURIComponent(objToSend[p])
        ).join('&');
        
        xhr.send(data);
        
        return result;
    }
    

    // <gpx>
    // <gpx>/<metadata>
    // <gpx>/<trk>
    // <gpx>/<trk>/<trkseg>
    // <gpx>/<trk>/<trkseg>/<trkpt>
    this.prepareGpx = function(gpxData) {
        let file = {
            attribs: {
                version: "1.1",
                creator: "Sinotrack export",
                xmlns: "http://www.topografix.com/GPX/1/1",
                'xmlns:xsi': "http://www.w3.org/2001/XMLSchema-instance",
                'xsi:schemaLocation': "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v2 https://www8.garmin.com/xmlschemas/TrackPointExtensionv2.xsd",
                'xmlns:sino': "http://bogus-z-polska.pl/xmlschemas/sinotrack/v1",
                'xmlns:gpxtpx': "http://www.garmin.com/xmlschemas/TrackPointExtension/v2"
            }
        }
        Object.keys(gpxData).forEach(key => file[key] = gpxData[key])
        return file
    }
    
    this.serializeXml = function(rootElementName, data) {
        let result = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';
        result += this.serializeXmlNode(rootElementName, data);
        return result;
    }
    
    this.serializeXmlNode = function(elementName, data) {
        if (Array.isArray(data)) {
            return data.map(e => this.serializeXmlNode(elementName, e)).join('');
        }
        let result = '<' + elementName;
        if (typeof data.attribs !== 'undefined') {
            let attribs = data.attribs;
            result += ' ' + Object.keys(attribs).map(a => a + '="' + utils.escapeXmlValue(utils.myToString(attribs[a])) + '"').join(' ');
            delete data.attribs;
        }
        if (typeof data === "string") {
            if (data === "") {
                return result + '/>\n';
            } else {
                result += '>' + utils.escapeXmlText(data) + '</' + elementName + '>\n';
            }
            return result;
        }
        if (typeof data === "number" || typeof data === "boolean") {
            result += '>' + data + '</' + elementName + '>\n';
            return result;
        }
        let keys = Object.keys(data);
        if (keys.length == 0) {
            return result + '/>\n';
        }
        result += '>\n';
        result += keys
            .filter(k => {let v = data[k]; return v !== null && typeof v !== 'undefined';})
            .map(k => this.serializeXmlNode(k, data[k])).join('');
        result += '</' + elementName + '>\n';
        return result;
    }    
}

var utils = new function() {
    this.longRandom = function() { return Math.floor(100000000000000 * Math.random()).toString(); }

    this.myToString = function(x) { return String(x).toString(); }

	this.recordDelimeter = '\x11'; //   
	this.endDelimeter = '\x1B';    //   
    
    this.pad = function(x) { return x < 10 ? '0' + x : '' + x; }
    this.dateToStr = function(x) { return x.getFullYear() + '-' + this.pad(x.getMonth()+1) + '-' + this.pad(x.getDate()); }
    this.timeToStr = function(x) { return this.pad(x.getHours()) + ':' + this.pad(x.getMinutes()); }

    this.parseDateTime = function(date, time) {
        let dt = new Date(date + 'T' + time);
        return dt.getTime() / 1000 - dt.getTimezoneOffset() * 60;
    }
    
    this.escapeXmlValue = function(unsafe) {
        return unsafe.replace(/[<>&'"]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
        });
    }
    this.escapeXmlText = function(unsafe) {
        return unsafe.replace(/[<>&]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
            }
        });
    }
}

// ----------------------------------- TOOLS -----------------------------------

var log = new function() {
    this.isInfoEnabled = () => doDebug > 0;
    this.isDebugEnabled = function() { return doDebug > 1; }
    this.isTraceEnabled = function() { return doDebug > 2; }
    this.warn = function(message) {
        this.renderMessage('W', arguments);
    }
    this.info = function(message) {
        if (doDebug > 0)
            this.renderMessage('I', arguments);
    }
    this.debug = function(message) {
        if (doDebug > 1)
            this.renderMessage('D', arguments);
    }
    this.trace = function(message) {
        if (doDebug > 2)
            this.renderMessage('T', arguments);
    }
    this.always = function(message) {
        this.renderMessage('A', arguments);
    }
    this.renderMessage = function(level, args) {
        if (args.length == 0) return;
        let now = new Date();
        let dateText = '[' + (now.getHours() < 10 ? ' ' + now.getHours() : now.getHours());
        dateText += ':';
        dateText += now.getMinutes() < 10 ? '0' + now.getMinutes() : now.getMinutes();
        dateText += ':';
        dateText += now.getSeconds() < 10 ? '0' + now.getSeconds() : now.getSeconds();
        dateText += '.';
        dateText += now.getMilliseconds() < 10 ? '00' + now.getMilliseconds() : now.getMilliseconds() < 100 ? '0' + now.getMilliseconds() : now.getMilliseconds();
        dateText += '][' + level + '] ';
        let msg = args[0].toString();
        if (args.length == 1){
            console.log(dateText + msg);
            return;
        }
        let logData = [];
        logData.push = function(){
            for (let arg of arguments){
                if (typeof arg === 'string'){
                    arg = arg.trim();
                    if (arg !== '') {
                        Array.prototype.push.call(this, arg);
                    }
                } else {
                    Array.prototype.push.call(this, arg);
                }
            }
        }
        logData.push(dateText);
        for (let i=1; i<args.length; i++){
            let idx = msg.indexOf('{}');
            if (idx < 0) {
                break;
            }
            let replacement = args[i];
            logData.push(msg.substr(0, idx));
            if (replacement === null){
                logData.push('null');
            } else
            if (typeof replacement === 'function'){
                try{
                    const v = replacement.apply();
                    logData.push(v);
                }catch(e){
                    logData.push('//error while calling', replacement, ':', e, '//');
                }
            } else
            if (typeof replacement === 'undefined'){
                logData.push('undefined');
            } else {
                logData.push(replacement);
            }
            msg = msg.substr(idx+2);
        }
        logData.push(msg);
        console.log.apply(console, logData);
    }
}

var dom = new function(){

    this.getNodeByCss = function(cssSelector, rootNode)
    {
        if (rootNode === undefined){
            return document.querySelector(cssSelector);
        }
        const nodes = rootNode.querySelectorAll(cssSelector);
        if (nodes.length == 0){
            return null;
        }
        return nodes[0];
    }

    this.getNodesByCss = function(cssSelector, rootNode)
    {
        const nodes = (rootNode || document).querySelectorAll(cssSelector);
        return [...nodes];
    }

    this.createElem = function(tag, attr, chlid) {
        const el = document.createElement(tag);
        if (typeof chlid === 'string' || chlid instanceof String){
            el.textContent = chlid;
        } else
        if (chlid instanceof HTMLElement){
            el.appendChild(chlid);
        }
        if (typeof attr !== 'undefined')
            for (let [k, v] of Object.entries(attr))
                el.setAttribute(k, v);
        return el;
    }
}

// ----------------------------------- MAIN -----------------------------------
var main = new function(){

    // main loader
    this.loadAndDispatch = async function(){
        log.info('loadAndDispatch - start')
        try {
            engine.init();
        } catch (e) {
            log.always('Failed to process something, {}', e);
            // throw e;
        }
    }

    this.waitForLoad = function(){
        if (typeof wnd.MGTS !== 'undefined' && engine.findAndInit()) {
            return Promise.resolve()
        }
        const start = performance.now()
        return new Promise( (resolve, reject) => {
            const timer = setInterval(() => {
                if (typeof wnd.MGTS !== 'undefined' && engine.findAndInit()) {
                    clearInterval(timer)
                    resolve()
                } else
                if (this.destroyed || (performance.now() - start > 300000)) {
                    clearInterval(timer)
                    reject('timeout while waiting for Sinotrack objects')
                }
            }, 500)
        })
    }
    
    this.destroy = function() {
      	this.destroyed = true;
        engine.destroy();
    }
}

// main function
log.info('sinogpx: {}, {}', window.location, document.readyState);

try {
    wnd = unsafeWindow;
    log.always('Got unsafeWindow');
} catch(e) {
    log.always('Got window');
    wnd = window;
}

try{
    wnd.sinogpx.main.destroy();
} catch (e) {
    log.always('Failed to unload: {}', e);
}

const start = () => main.waitForLoad().then(main.loadAndDispatch.bind(main)).catch(err => log.always('{}', err))

if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, false)
} else {
    start()
}
  
wnd.sinogpx = {
    main: main,
    engine: engine,
    dom: dom,
    log: log,
}

})();
