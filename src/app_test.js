import http from 'http';

const hostname = '127.0.0.1';
// const port = process.env.NODE_ENV === 'production' ? 80 : 3010;
const port = 3010;

const server = http.createServer((req, res) => {
    if (req.url === '/route1') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end('This is Route 1\n');
    } else if (req.url === '/route2') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end('This is Route 2\n');
    } else {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Hello World Brenda2\n');
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});