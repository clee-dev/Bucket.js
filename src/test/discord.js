

/*const makeProxy = (c) => {
    return function () {
        let obj = new c();
        return new Proxy(obj, {
            get(target, path, receiver) {
                if (path in obj) return obj[path];
                throw new Error(`Tried to get ${path}`)
            },
            set(target, path, value) {
                if (path in obj) {
                    obj[path] = value;
                } else {
                    throw new Error(`Tried to set ${path} to ${val}`)
                }
            }
        })
    }
}*/

const readline = require('readline');


class ClientUser {
    constructor() {
        this.id = 'localhost_id';
        this.tag = 'localhost';
    }
}

class Channel {
    constructor(name) {
        this.name = name;
        this.id = `${name}_id`;
    }
}

class Message {
    constructor(content, channel) {
        this.content = content;
        this.guild = 'dummy_guild'
        this.author = {
            id: 'admin_id',
            username: 'admin'
        }
        this.channel = channel;
    }
    isMentioned() {
        return false;
    }
}

class Client {
    constructor() {
        this.user = new ClientUser();
        this.events = {};
        this.channels = [new Channel('default')];
    }
    on(evt, func) {
        if (this.events[evt] == undefined) this.events[evt] = [];
        this.events[evt].push(func);
    }
    trigger(evt, ...args) {
        if (this.events[evt] == undefined) this.events[evt] = [];
        this.events[evt].forEach(func => func(...args));
    }
    login(token) {
        this.trigger('ready');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.on('line', (line) => {
            this.trigger('message', new Message(line, this.channels[0]))
        })
    }
}

module.exports = {
    Client
};
