const B = require('../B.js');
const secrets = require('../secrets.json');

const {
    learnNewFactoid,
    unlearnFactoid,
    setSilencedState,
    getInventory,
    getLastFactoidData,
    getLastLearnedFactoidData,
    chance,
    getRandomElement,
} = require('./util.js');

const disabled = [
    /*
        const swearJarRegex = /^how much is in the swear jar[.?!]*$/;
        if (swearJarRegex.test(lower)) {
            let swearjar = await db.collection('swearjar').get();
            let totalPennies = 0;
            if (!swearjar.empty) swearjar.docs.forEach(x => (totalPennies += x.data().total));

            message.channel.send(
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
    new B('mention:check-inventory', async ({ message }) => {
        return secrets.admins[message.author.username] &&
            /^inventory\?$/i.test(message.content);
    }, async ({ message, db }) => {
        let out = '';
        const inventory = await getInventory(db);
        inventory.forEach(item => {
            if (item.name.startsWith('his') || item.name.startsWith('her'))
                out += `${item.user.username}'s ${item.name.substring(4)}, `;
            else if (item.name.startsWith('their')) out += `${item.user.username}'s ${item.name.substring(6)}, `;
            else out += item.name + ', ';
        });
        out = out === '' ? "I don't have anything :(" : out.substring(0, out.length - 2);
        message.channel.send(out);
    }, { ...options, silent: true }),

    new B('mention:come-back', async ({ message }) => {
        return /^come back[.?!]*$/i.test(message.content);
    }, async ({ message, db }) => {
        await setSilencedState(false, db);
        message.channel.send('\\\\o/');
    }, { ...options, silent: true }),

    new B('mention:shut-up', async ({ message }) => {
        const shutUpMap = { // in minutes
            [1 * 60 * 1000]: /^(shut up|be quiet) for a min(ute)?\W?$/,
            [5 * 60 * 1000]: /^(shut up|be quiet) for a bit\W?$/,
            [30 * 60 * 1000]: /^(shut up|be quiet)\b/,
        };
        const valid = Object.entries(shutUpMap)
            .find(arr => arr[1].test(message.content.toLowerCase()));
        return valid && valid[0];
    }, async ({ message, db }, timeout) => {
        await setSilencedState(true, db);
        message.channel.send('Okay');

        setTimeout(() => {
            setSilencedState(false, db);
        }, timeout);
    }, options),

    new B('mention:forget-last-learned', async ({ message, db }) => {
        const user = message.author;
        if (/^undo last$/i.test(message.content)) {
            const last = await getLastLearnedFactoidData(db);
            return (secrets.admins[user.username] || last.user.id === user.id) &&
                last;
        }
    }, async ({ message, db }, last) => {
        const user = message.author;
        await unlearnFactoid(last.X, last.Middle, last.Y, db);
        db.collection('state')
            .doc('lastLearnedFactoid')
            .delete();

        message.channel.send(`Okay, ${user.username}, forgetting ${last.X} <${last.Middle}> ${last.Y}`);
    }, options),

    new B('mention:forget-last-activated', async ({ message, db }) => {
        const user = message.author;
        if (/^forget that[.?!]*$/i.test(message.content)) {
            const last = await getLastFactoidData(db);
            return (secrets.admins[user.username] || last.user.id === user.id) &&
                last;
        }
    }, async ({ message, db }, last) => {
        const user = message.author;
        await unlearnFactoid(last.X, last.Middle, last.Y, db);
        db.collection('state')
            .doc('lastFactoid')
            .delete();

		message.channel.send(`Okay, ${user.username}, forgetting ${last.X} <${last.Middle}> ${last.Y}`);
    }, options),

    new B('mention:describe-last-activated', async ({ message, db }) => {
        const user = message.author;
        if (/^what was that[.?!]*$/i.test(message.content)) {
            const last = await getLastFactoidData(db);
            return (secrets.admins[user.username] || last.user.id === user.id) &&
                last;
        }
    }, async ({ message }, last) => {
        message.channel.send(`That was: ${last.X} <${last.Middle}> ${last.Y}`);
    }, options),

    new B('mention:learn-factoid', async ({ message }) => message.content.match(/(.+) (<([_^]?[^@].+)>|is|are) (.+)/i),
    async ({ message, db }, matches) => {
		const x = matches[1];
		const mid = matches[3] || matches[2];
		const y = matches[4];

		if (chance(98)) learnNewFactoid(x, mid, y, message, db);
		else message.channel.send(`Your mom is ${y}!`);
    }, options),

    new B('mention:user-quotes', async ({ message, client }) => {
       const matches = message.content.match(/^([^\s]+) quotes$/i);
       if (!matches) return;

       const name = matches[1];
       const users = Array.from(client.users).map(x => x[1]);
       return users.find(x => x.username.toLowerCase() === name);
    }, async ({ message, db }, user) => {
        const quotes = await db
            .collection('quotes')
            .where('user.username', '==', user.username)
            .get();
        if (!quotes.empty) {
            const quote = getRandomElement(quotes.docs).data().quote;
            message.channel.send(`${user.username}: ${quote}`);
        } else {
            message.channel.send(`I don't have any quotes for ${name}`);
        }
    }, options),

    new B('mention:remember-quote', async ({ message }) => {
        const matches = message.content.match(/^remember ([^\s]+) (.+)/i);
        if (!matches) return;

        const name = matches[1];
		const users = Array.from(client.users).map(x => x[1]);
        const user = users.find(x => x.username.toLowerCase() === name);
        if (!user) return;

        const fetch = await message.channel.fetchMessages({ limit: 50 });
        const remember = Array.from(fetch)
            .map(x => x[1])
            .filter(x => x.id !== message.id)
            .filter(x => x.author.id === user.id)
            .find(x => x.content.toLowerCase().includes(matches[2].toLowerCase()));
        return remember;
    }, async ({ message, db }, remember) => {
        message.channel.send(`Okay, remembering ${user.username} said ${remember}`);
        db.collection('quotes')
            .doc(uuid())
            .set({ user: { id: user.id, username: user.username }, quote: remember });
        return;
    }, options),

    new B('mention:give-present', async ({ message, db }) => {
        const match = message.content.match(/^(i want a|give me a) (present|gift)[.?!]*$/i);
        if (!match) return;

        const inv = await getInventory(db);
        return inv.length && inv; // [] is truthy
    }, async ({ message, db }, inventory) => {
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

    new B('mention:do-you-know', async ({ message }) => message.content.test(/^do you know .+/i),
    async ({ message }) => {
        message.channel.send('No, but if you hum a few bars I can fake it.');
    }, options),

    new B('mention:this-or-that', async ({ message }) => message.content.match(/(should (i|we) )?(.+) or (should (i|we) )?([^?!.]+)/i),
    async ({ message }, matches) => {
		const X = matches[3];
		const Y = matches[6];
		message.channel.send(getRandomElement([X, Y]));
    }, options),
];

module.exports = enabled;