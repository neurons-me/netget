// logParsers.js — pure log-line parsing, split out of proxy.js so
// routes/localNetget.js's /logs route can import it WITHOUT a circular
// dependency (localNetget.js <-> proxy.js: proxy.js mounts
// localNetgetRoutes, localNetget.js used to import parseLogLine back from
// proxy.js — a cycle that only "worked" because proxy.js always happened
// to be the real entrypoint in production, and broke the moment anything
// else, e.g. a test, imported localNetget.js first). No other module
// needs to change: proxy.js re-exports these same names for compatibility.

export function parseLogLine(line, index, logStructure) {
    try {
        switch (logStructure) {
            case 'nginx_access':  return parseNginxAccessLog(line, index);
            case 'nginx_error':   return parseNginxErrorLog(line, index);
            case 'server':        return parseServerLog(line, index);
            default:              return null;
        }
    } catch {
        return { id: index, timestamp: new Date().toISOString(), level: 'UNKNOWN', message: line, fullLine: line, parsed: false };
    }
}

function parseNginxAccessLog(line, index) {
    const re = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
    const m = line.match(re);
    if (m) {
        const [, ip, ts, req, status, size, referer, ua] = m;
        const [method, reqPath = ''] = req.split(' ');
        return {
            id: index, timestamp: convertNginxTimestamp(ts), level: statusLevel(+status),
            method, path: decodeURIComponent(reqPath).substring(0, 500),
            status: +status, size: +size, ip: ip !== '-' ? ip : null,
            userAgent: ua !== '-' ? ua.substring(0, 150) : null,
            referer: referer !== '-' ? referer.substring(0, 200) : null,
            message: `${method} ${reqPath} - ${status}`,
            fullLine: line, parsed: true, logType: 'access',
        };
    }
    return { id: index, timestamp: new Date().toISOString(), level: 'INFO', message: line, fullLine: line, parsed: false, logType: 'access' };
}

function parseNginxErrorLog(line, index) {
    const re = /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(\d+)#(\d+):\s*(.*)/;
    const m = line.match(re);
    if (m) {
        const [, ts, level, pid, tid, message] = m;
        return { id: index, timestamp: convertNginxErrorTimestamp(ts), level: level.toUpperCase(), pid: +pid, tid: +tid, message, fullLine: line, parsed: true, logType: 'error' };
    }
    return { id: index, timestamp: new Date().toISOString(), level: 'ERROR', message: line, fullLine: line, parsed: false, logType: 'error' };
}

function parseServerLog(line, index) {
    const parts = line.split(' - ');
    if (parts.length >= 2) {
        const [ts, rest] = parts;
        const [method, p = ''] = rest.split(' ');
        return { id: index, timestamp: ts, level: 'INFO', method, path: p, message: `${method} ${p}`, fullLine: line, parsed: true, logType: 'server' };
    }
    return { id: index, timestamp: new Date().toISOString(), level: 'INFO', message: line, fullLine: line, parsed: false, logType: 'server' };
}

function convertNginxTimestamp(s) {
    try {
        const m = s.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return new Date().toISOString();
        const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
        return new Date(`${m[3]}-${months[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}.000Z`).toISOString();
    } catch { return new Date().toISOString(); }
}

function convertNginxErrorTimestamp(s) {
    try { return new Date(s.replace(/\//g, '-')).toISOString(); }
    catch { return new Date().toISOString(); }
}

function statusLevel(status) {
    if (status >= 500) return 'ERROR';
    if (status >= 400) return 'WARN';
    return 'INFO';
}
