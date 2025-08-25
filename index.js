import NetGet from './src/netget.js';
import { verifyInitialization } from './src/scripts/init_dirs.js';
export { defaultHandler } from './src/routes/defaultHandlers.js';
// Verify directory initialization
const getInit = verifyInitialization();
let get = "undefined";
if (!getInit) {
    get = "undefined";
    console.error("no .get set.");
} else {
    get = "getset"
    console.log(".get set.");
}
export default NetGet;
console.log("NetGet Loaded v2.5;");
