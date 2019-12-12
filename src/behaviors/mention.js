const B = require('../B.js');
const config = require('../config.json');
const secrets = require('../secrets.json');

const {
    getWords,
    filterNonWords,
    respondVaguely,
    getFactoid,
    learnNewFactoid,
    unlearnFactoid,
    learn,
    getSilencedState,
    setSilencedState,
    expUp,
    expDown,
    convertVars,
    detectedFactoids,
    escapeRegExp,
    processFactoid,
    getInventory,
    getLastFactoid,
    getLastFactoidData,
    setLastFactoid,
    getLastLearnedFactoid,
    getLastLearnedFactoidData,
    setLastLearnedFactoid,
    incrementDocField,
    getUsersFromGuild,
    getRandomInt,
    chance,
    getRandomElement,
    hasDuplicates
} = require('./util.js');

const disabled = [
    /*
        const swearJarRegex = /^how much is in the swear jar[.?!]*$/;
        if (swearJarRegex.test(lower)) {
            let swearjar = await db.collection('swearjar').get();
            let totalPennies = 0;
            if (!swearjar.empty) swearjar.docs.forEach(x => (totalPennies += x.data().total));

            channel.send(
                `The swear jar currently holds ${(totalPennies / 100).toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                })}`
            );
            return;
        }
    */
];

const options = { mention: true, nonmention: false };

const enabled = [
    new B(async (message, db) => { // checking inventory
        return secrets.admins[message.author.username] &&
            /^inventory\?$/i.test(message.content);
    }, async (data, message, db) => {
        let out = '';
        const inventory = await getInventory();
        inventory.forEach(item => {
            if (item.name.startsWith('his') || item.name.startsWith('her'))
                out += `${item.user.username}'s ${item.name.substring(4)}, `;
            else if (item.name.startsWith('their')) out += `${item.user.username}'s ${item.name.substring(6)}, `;
            else out += item.name + ', ';
        });
        out = out === '' ? "I don't have anything :(" : out.substring(0, out.length - 2);
        message.channel.send(out);
    }, { ...options, silent: true }),

    new B(async (message, db) => {
        return /^come back[.?!]*$/i.test(message.content);
    }, async (data, message, db) => {
        setSilencedState(false);
        message.channel.send('\\\\o/');
    }, { ...options, silent: true }),

    new B(async (message, db) => { // silencing bucket
        const shutUpMap = { // in minutes
            [1 * 60 * 1000]: /^(shut up|be quiet) for a min(ute)?\W?$/,
            [5 * 60 * 1000]: /^(shut up|be quiet) for a bit\W?$/,
            [30 * 60 * 1000]: /^(shut up|be quiet)\b/,
        };
        const valid = Object.entries(shutUpMap)
            .find(arr => arr[1].test(message.content.toLowerCase()));
        return valid && valid[0];
    }, async (timeout, message, db) => {
        setSilencedState(true);
        message.channel.send('Okay');

        setTimeout(() => {
            setSilencedState(false);
        }, timeout);
    }, options),

    new B(async (message, db) => { // forget last-LEARNED factoid
        const user = message.author;
        if (/^undo last$/i.test(message.content)) {
            const last = getLastLearnedFactoidData();
            return (secrets.admins[user.username] || last.user.id === user.id) &&
                last;
        }
    }, async (last, message, db) => {
        const user = message.author;
        await unlearnFactoid(last.X, last.Middle, last.Y);
        db.collection('state')
            .doc('lastLearnedFactoid')
            .delete();

        message.channel.send(`Okay, ${user.username}, forgetting ${last.X} <${last.Middle}> ${last.Y}`);
    }, options),

    new B(async (message, db) => { // forget last-ACTIVATED factoid
        const user = message.author;
        if (/^forget that[.?!]*$/i.test(message.content)) {
            const last = getLastFactoidData();
            return (secrets.admins[user.username] || last.user.id === user.id) &&
                last;
        }
    }, async (last, message, db) => {
        const user = message.author;
        await unlearnFactoid(last.X, last.Middle, last.Y);
        db.collection('state')
            .doc('lastFactoid')
            .delete();

		message.channel.send(`Okay, ${user.username}, forgetting ${last.X} <${last.Middle}> ${last.Y}`);
    }, options),

    new B(async (message, db) => { // describe last-ACTIVATED factoid
        const user = message.author;
        if (/^what was that[.?!]*$/i.test(message.content)) {
            const last = await getLastFactoidData();
            return (secrets.admins[user.username] || last.user.id === user.id) &&
                last;
        }
    }, async (last, message, db) => {
        message.channel.send(`That was: ${last.X} <${last.Middle}> ${last.Y}`);
    }, options),

    new B(async (message, db) => message.content.match(/(.+) (<([_^]?[^@].+)>|is|are) (.+)/i), // being taught a factoid
    async (matches, message, db) => {
		const x = matches[1];
		const mid = matches[3] || matches[2];
		const y = matches[4];

		if (chance(98)) learnNewFactoid(x, mid, y, user, channel);
		else message.channel.send(`Your mom is ${y}!`);
    }, options),

    new B(async (message, db, client) => {
       const matches = message.content.match(/^([^\s]+) quotes$/i);
       if (!matches) return;

       const name = matches[1];
       const users = Array.from(client.users).map(x => x[1]);
       const user = users.find(x => x.username.toLowerCase() === name);
       return user;
    }, async (user, message, db, client) => {
        const quotes = await db
            .collection('quotes')
            .where('user.username', '==', user.username)
            .get();
        if (!quotes.empty) {
            const quote = getRandomElement(quotes.docs).data().quote;
            channel.send(`${user.username}: ${quote}`);
        } else {
            channel.send(`I don't have any quotes for ${name}`);
        }
    }, options),

    new B(async (message, db) => {
        const matches = message.content.match(/^remember ([^\s]+) (.+)/i);
        if (!matches) return;

        const name = matches[1];
		const users = Array.from(client.users).map(x => x[1]);
        const user = users.find(x => x.username.toLowerCase() === name);
        if (!user) return;

        const fetch = await channel.fetchMessages({ limit: 50 });
        const remember = Array.from(fetch)
            .map(x => x[1])
            .filter(x => x.id !== message.id)
            .filter(x => x.author.id === user.id)
            .find(x => x.content.toLowerCase().includes(matches[2].toLowerCase()));
        return remember;
    }, async (remember, message, db) => {
        channel.send(`Okay, remembering ${user.username} said ${remember}`);
        db.collection('quotes')
            .doc(uuid())
            .set({ user: { id: user.id, username: user.username }, quote: remember });
        return;
    }, options),

    new B(async (message, db) => {
        const match = message.content.match(/^(i want a|give me a) (present|gift)[.?!]*$/i);
        if (!match) return;

        const inv = await getInventory();
        return inv.length && inv; // [] is truthy
    }, async (inventory, message, db) => {
        const give = getRandomElement(inventory);
        message.channel.send(
			`*gives ${user.username} ${
				give.name.startsWith('his')
					? give.name.replace('his', give.user.username)
					: give.name.startsWith('her')
					? give.name.replace('her', give.user.username)
					: give.name.startsWith('their')
					? give.name.replace('their', give.user.username)
					: give.name
			}*`
        );
        db.collection('items')
            .doc(give.name)
            .delete();
    }, options),

    new B(async (message, db) => message.content.test(/^do you know .+/i),
    async (data, message, db) => {
        message.channel.send('No, but if you hum a few bars I can fake it.');
    }, options),

    new B(async (message, db) => message.content.match(/(should (i|we) )?(.+) or (should (i|we) )?([^?!.]+)/i),
    async (matches, message, db) => {
		const X = matches[3];
		const Y = matches[6];
		message.channel.send(getRandomElement([X, Y]));
    }, options),
];

module.exports = enabled;

/*

    new B((message, db) => {

    }, (data, message, db) => {

    }, options),
*/