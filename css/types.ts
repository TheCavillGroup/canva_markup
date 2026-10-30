export interface Decl {
    prop : string,
    value : string
}

/** A rejected value, with what's wrong and how to fix it */
export interface Problem {
    problem : string,
    fix? : string,
    range? : boolean
}
