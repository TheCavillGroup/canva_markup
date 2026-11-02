/** Debug breadcrumbs: a Canva app's own console isn't reachable from outside its iframe, so hosts can forward these */
export type Trace = (msg : string, data? : unknown) => void;

export const noTrace : Trace = () => {};
