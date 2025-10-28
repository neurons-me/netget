import NetGet from './src/netget.ts';
import { verifyInitialization } from './src/scripts/init_dirs.ts';
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
console.log("NetGet Loaded v2.6.51;");
