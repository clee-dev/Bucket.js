module.exports = class Logger {
    constructor(client, logChannels) {
        const logChannelIDs = Object.values(logChannels);
        this.channels = client.channels.filter(c => logChannelIDs.includes(c.id));
    }

    log(...args) {
        console.log(...args);
        this.postInChannels(args.join('\r\n'));
    }

    logInner(...args) {
        console.log(...args);
        this.postInChannels('>>>' + this.str(args));
    }

    str(args) {
        return args.map(a => JSON.stringify(a)).join('\r\n');
    }

    postInChannels(msg) {
        this.channels.forEach(channel => channel.send(msg));
    }
}