/** What applying a page did to one element */
export type ApplyAction = "created" | "updated" | "replaced" | "moved" | "deleted" | "unchanged";

export interface ElementResult {
    action : ApplyAction,
    /** node path in the applied markup ("" for deletions) */
    path : string,
    /** data-id of an existing element */
    id? : string,
    /** data-id minted for a created element */
    newId? : string,
    warning? : string
}

/** Something the apply did that the markup author should know (e.g. "font_weight", "canva_changed") */
export interface ApplyWarning {
    code : string,
    message : string,
    path? : string,
    dataId? : string
}

/** One page of a design, as a Canva app sees it */
export interface PageSummary {
    index : number,
    /** missing for pages apps can't use (e.g. Canva Docs pages) */
    id? : string,
    title? : string,
    width? : number,
    height? : number,
    /** the page the user is on */
    current : boolean
}
