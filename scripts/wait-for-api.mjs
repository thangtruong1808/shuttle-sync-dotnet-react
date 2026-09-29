import net from "node:net";

const port = 5284;
const deadline = Date.now() + 120_000;

function canConnect(host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

while (Date.now() < deadline) {
  if ((await canConnect("127.0.0.1")) || (await canConnect("::1"))) {
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}

console.error("The API did not start on port 5284.");
process.exit(1);
