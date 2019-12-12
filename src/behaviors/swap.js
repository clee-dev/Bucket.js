const B = require('../B.js');

const {
} = require('../util.js');

const disabled = [
];

const enabled = [
    new B(async (message, db) => { // swap ex => sex
		const m = message.content.replace(/\bex\w+(?!:)\b/i, (match) => {
			const isUppercase = match[0].toUpperCase() === match[0];
			return isUppercase ? 'Sex' : 'sex';
        });
        return message.content !== m && m;
    }, async (send, message, db) => message.channel.send(send)),
    
    new B(async (message, db) => { // swap elect => erect
		const m = message.content.replace(/\belect\w+(?!:)\b/i, (match) => {
			const isUppercase = match[0].toUpperCase() === match[0];
			return isUppercase ? 'Erect' : 'erect';
        });
        return message.content !== m && m;
    }, async (send, message, db) => message.channel.send(send)),
    
    new B(async (message, db) => { // swap the/this fuckin(g) => fuckin(g) the/this
        const m = message.content.replace(/\b(the|this) fucking?\b/i, (match) => match.split(' ').reverse().join(' '));
        return message.content !== m && m;
    }, async (send, message, db) => message.channel.send(send)),
];

module.exports = enabled;