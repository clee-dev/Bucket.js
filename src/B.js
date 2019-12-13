class B {
    constructor(
        name,
        check,
        action,
        {
            mention = false,
            nonmention = true,
            silent = false
        } = { mention: false, nonmention: true, silent: false }) {
        this.name = name;
        this.check = check;
        this.action = action;
        this.mention = mention;
        this.nonmention = nonmention;
        this.silent = silent;
    }
}

module.exports = B;
