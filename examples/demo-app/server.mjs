import { createServer } from 'node:http';

createServer((request, response) => {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(
    JSON.stringify(
      {
        message:
          'Inside the demo. This application does not verify signatures or read cookies.',
        headers: Object.fromEntries(
          Object.entries(request.headers).filter(([key]) =>
            key.startsWith('x-gozne-'),
          ),
        ),
      },
      null,
      2,
    ),
  );
}).listen(8080, '0.0.0.0');
