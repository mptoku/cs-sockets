//Require Build In
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

//My Consts
const hostname = 'localhost';
const port = 9999;
const webSocketMagicString = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const STATE_START = 0;
const STATE_GET_LENGTH = 1;
const STATE_GET_MASK = 2;
const STATE_GET_DATA = 3;

//Create Server
const server = http.createServer((requestIncoming, responseOutGoing) => {
    responseOutGoing.statusCode = 200;
    responseOutGoing.setHeader('Contenet-Type', 'text/html');

    fs.readFile('index.html', function(error, content){ 
        responseOutGoing.end(content);
    });    
});

server.listen(port, hostname, () => {
    console.log(`Server is online on http://${hostname}:${port}`);
});

server.on('upgrade', (request, socket, head) => {
    var secWebSocketKey = request.headers['sec-websocket-key'] + webSocketMagicString;
    var hashedKey = crypto.createHash('SHA1').update(secWebSocketKey).digest('base64');
    
    //Send Back to requester
    socket.write( 
          'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + 'Sec-WebSocket-Accept: '+hashedKey+'\r\n'
        + '\r\n'
    );

    socket.cs = {
        socket : socket,
        buffer : Buffer.allocUnsafe(0),
        state : STATE_START,
        payloadLength : 0,
        payloadStart : 0,
        cont : false,
        continuationBuffer : Buffer.allocUnsafe(0),
        finished : true
    }

    socket.cs.start = function(){
        //console.log('Starting...');
        if(this.buffer.length < 2) return;
        this.maskOpBlah = this.bufferRead(1)[0];
        if(this.maskOpBlah !== 129){
            if(this.maskOpBlah == 1){
                console.log('Text Not Finished');
                this.finished = false;
            }
            if(this.maskOpBlah == 128){
                console.log('Continuation finished: ' + this.continuationBuffer.length);
                this.finished = true;
            }
            console.log('wtf: ' + this.buffer.length, this.maskOpBlah, this.buffer[0]);
            //return;
            this.cont = true;
        } 
        this.payloadLength = this.bufferRead(1)[0] & 0x7f; 
        if(this.payloadLength === 126){
            this.state = STATE_GET_LENGTH;
            this.getLength();
        } else {
            this.state = STATE_GET_MASK;
            this.getMask();
        }
    }
    
    socket.cs.getLength = function(){
        //console.log('Getting Length...');
        if(this.buffer.length < 2) return
        this.payloadLength = this.bufferRead(2).readUInt16BE(0);
        this.state = STATE_GET_MASK;
        this.getMask();
    }

    socket.cs.getMask = function(){
        //console.log('Getting Mask...');
        if(this.buffer.length < 4) return
        this.mask = this.bufferRead(4);
        this.state = STATE_GET_DATA;
        this.getData();
    }
    
    socket.cs.getData = function(){
        //console.log('Getting Data...');
        if(this.buffer.length >= this.payloadLength + this.payloadStart){
            //Create Buffer Header
            var payloadOffset = (this.payloadLength < 125) ? 2 : 4;
            var response = Buffer.allocUnsafe(this.payloadLength);
            //Unmask Data
            var unMaskedData = '';
            var unMaskedBuffer = this.bufferRead(this.payloadLength);
            for(var i = 0; i < unMaskedBuffer.length; i++){
                response.writeUInt8(unMaskedBuffer[i] ^ this.mask[i % 4], i);
            }

            //Write back or save for later
            if(this.finished === true){
                this.frameDataAndSend(response);
            } else {
                //Appending continuation
                console.log('appending: ' + response.length);
                this.continuationBuffer = Buffer.concat([this.continuationBuffer, response]);
            }
            
            this.state = STATE_START;
            this.start();
        }
    }

    socket.cs.frameDataAndSend = function(data){
        if(data.length < 125){
            var header = Buffer.allocUnsafe(2);
            header.writeUInt8(129, 0);
            header.writeUInt8(data.length+this.continuationBuffer.length, 1);
        } else {
            var header = Buffer.allocUnsafe(4);
            header.writeUInt8(129, 0);
            header.writeUInt8(126, 1);
            header.writeUInt16BE(data.length+this.continuationBuffer.length, 2);
        }

        this.socket.write(Buffer.concat([header, this.continuationBuffer, data]));
        this.continuationBuffer = Buffer.allocUnsafe(0);
    }

    socket.cs.bufferRead = function(cnt){
        var read = Buffer.allocUnsafe(cnt);
        for(var i = 0; i < cnt; i++){
            read.writeUInt8(this.buffer[i], i);
        }
        this.buffer = this.buffer.slice(i, this.buffer.length);
        return read;
    }
    //Start Keeping an Eye out for Data
    socket.on('data', (newData) => {
        //console.log('receiving data');
        socket.cs.buffer = Buffer.concat([socket.cs.buffer, newData]);

        switch(socket.cs.state){
            case STATE_START:
                socket.cs.start();
                break;
            case STATE_GET_LENGTH:
                socket.cs.getLength();
                break;
            case STATE_GET_MASK:
                socket.cs.getMask();
                break;
            case STATE_GET_DATA:
                socket.cs.getData();
                break;
        }
    });
});


function echoTextMessage(socket, str) { 
    if(str.length < 125) {
        var dataOffset = 2;
        var response = Buffer.allocUnsafe(dataOffset+str.length);
        response.writeUInt8(129, 0);
        response.writeUInt8(str.length, 1);
    } else {
        var dataOffset = 4;
        var response = Buffer.allocUnsafe(dataOffset+str.length);
        response.writeUInt8(129, 0);
        response.writeUInt8(126, 1);
        response.writeUInt16BE(str.length, 2);
    } 
    response.write(str, dataOffset);
    socket.write(response);
}