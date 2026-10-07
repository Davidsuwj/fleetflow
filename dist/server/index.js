// node_modules/postgres/cf/polyfills.js
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
var Crypto = globalThis.crypto;
var ids = 1;
var tasks = /* @__PURE__ */ new Set();
var v4Seg = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
var v4Str = `(${v4Seg}[.]){3}${v4Seg}`;
var IPv4Reg = new RegExp(`^${v4Str}$`);
var v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg = new RegExp(
  `^((?:${v6Seg}:){7}(?:${v6Seg}|:)|(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:)))(%[0-9a-zA-Z-.:]{1,})?$`
);
var textEncoder = new TextEncoder();
var crypto2 = {
  randomBytes: (l) => Crypto.getRandomValues(Buffer.alloc(l)),
  pbkdf2Sync: async (password, salt, iterations, keylen) => Crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    await Crypto.subtle.importKey(
      "raw",
      textEncoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    ),
    keylen * 8,
    ["deriveBits"]
  ),
  createHash: (type) => ({
    update: (x) => ({
      digest: (encoding) => {
        if (!(x instanceof Uint8Array)) {
          x = textEncoder.encode(x);
        }
        let prom;
        if (type === "sha256") {
          prom = Crypto.subtle.digest("SHA-256", x);
        } else if (type === "md5") {
          prom = Crypto.subtle.digest("md5", x);
        } else {
          throw Error("createHash only supports sha256 or md5 in this environment, not ${type}.");
        }
        if (encoding === "hex") {
          return prom.then((arrayBuf) => Buffer.from(arrayBuf).toString("hex"));
        } else if (encoding) {
          throw Error(`createHash only supports hex encoding or unencoded in this environment, not ${encoding}`);
        } else {
          return prom;
        }
      }
    })
  }),
  createHmac: (type, key) => ({
    update: (x) => ({
      digest: async () => Buffer.from(
        await Crypto.subtle.sign(
          "HMAC",
          await Crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
          textEncoder.encode(x)
        )
      )
    })
  })
};
var performance = globalThis.performance;
var process = {
  env: {}
};
var os = {
  userInfo() {
    return { username: "postgres" };
  }
};
var fs = {
  readFile() {
    throw new Error("Reading files not supported on CloudFlare");
  }
};
var net = {
  isIP: (x) => IPv4Reg.test(x) ? 4 : IPv6Reg.test(x) ? 6 : 0,
  Socket
};
var tls = {
  connect({ socket: tcp, servername }) {
    tcp.writer.releaseLock();
    tcp.reader.releaseLock();
    tcp.readyState = "upgrading";
    tcp.raw = tcp.raw.startTls({ servername });
    tcp.raw.closed.then(
      () => tcp.emit("close"),
      (e) => tcp.emit("error", e)
    );
    tcp.writer = tcp.raw.writable.getWriter();
    tcp.reader = tcp.raw.readable.getReader();
    tcp.writer.ready.then(() => {
      tcp.read();
      tcp.readyState = "upgrade";
    });
    return tcp;
  }
};
function Socket() {
  const tcp = Object.assign(new EventEmitter(), {
    readyState: "open",
    raw: null,
    writer: null,
    reader: null,
    connect,
    write,
    end,
    destroy,
    read
  });
  return tcp;
  async function connect(port, host) {
    try {
      tcp.readyState = "opening";
      const { connect: connect2 } = await import("cloudflare:sockets");
      tcp.raw = connect2(host + ":" + port, tcp.ssl ? { secureTransport: "starttls" } : {});
      tcp.raw.closed.then(
        () => {
          tcp.readyState !== "upgrade" ? close() : (tcp.readyState = "open", tcp.emit("secureConnect"));
        },
        (e) => tcp.emit("error", e)
      );
      tcp.writer = tcp.raw.writable.getWriter();
      tcp.reader = tcp.raw.readable.getReader();
      tcp.ssl ? readFirst() : read();
      tcp.writer.ready.then(() => {
        tcp.readyState = "open";
        tcp.emit("connect");
      });
    } catch (err) {
      error(err);
    }
  }
  function close() {
    if (tcp.readyState === "closed")
      return;
    tcp.readyState = "closed";
    tcp.emit("close");
  }
  function write(data, cb) {
    tcp.writer.write(data).then(cb, error);
    return true;
  }
  function end(data) {
    return data ? tcp.write(data, () => tcp.raw.close()) : tcp.raw.close();
  }
  function destroy() {
    tcp.destroyed = true;
    tcp.end();
  }
  async function read() {
    try {
      let done, value;
      while ({ done, value } = await tcp.reader.read(), !done)
        tcp.emit("data", Buffer.from(value));
    } catch (err) {
      error(err);
    }
  }
  async function readFirst() {
    const { value } = await tcp.reader.read();
    tcp.emit("data", Buffer.from(value));
  }
  function error(err) {
    tcp.emit("error", err);
    tcp.emit("close");
  }
}
function setImmediate(fn) {
  const id2 = ids++;
  tasks.add(id2);
  queueMicrotask(() => {
    if (tasks.has(id2)) {
      fn();
      tasks.delete(id2);
    }
  });
  return id2;
}
function clearImmediate(id2) {
  tasks.delete(id2);
}

// node_modules/postgres/cf/src/types.js
import { Buffer as Buffer2 } from "node:buffer";

// node_modules/postgres/cf/src/query.js
var originCache = /* @__PURE__ */ new Map();
var originStackCache = /* @__PURE__ */ new Map();
var originError = Symbol("OriginError");
var CLOSE = {};
var Query = class extends Promise {
  constructor(strings, args, handler, canceller, options = {}) {
    let resolve, reject;
    super((a, b2) => {
      resolve = a;
      reject = b2;
    });
    this.tagged = Array.isArray(strings.raw);
    this.strings = strings;
    this.args = args;
    this.handler = handler;
    this.canceller = canceller;
    this.options = options;
    this.state = null;
    this.statement = null;
    this.resolve = (x) => (this.active = false, resolve(x));
    this.reject = (x) => (this.active = false, reject(x));
    this.active = false;
    this.cancelled = null;
    this.executed = false;
    this.signature = "";
    this[originError] = this.handler.debug ? new Error() : this.tagged && cachedError(this.strings);
  }
  get origin() {
    return (this.handler.debug ? this[originError].stack : this.tagged && originStackCache.has(this.strings) ? originStackCache.get(this.strings) : originStackCache.set(this.strings, this[originError].stack).get(this.strings)) || "";
  }
  static get [Symbol.species]() {
    return Promise;
  }
  cancel() {
    return this.canceller && (this.canceller(this), this.canceller = null);
  }
  simple() {
    this.options.simple = true;
    this.options.prepare = false;
    return this;
  }
  async readable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  async writable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  cursor(rows = 1, fn) {
    this.options.simple = false;
    if (typeof rows === "function") {
      fn = rows;
      rows = 1;
    }
    this.cursorRows = rows;
    if (typeof fn === "function")
      return this.cursorFn = fn, this;
    let prev;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (this.executed && !this.active)
            return { done: true };
          prev && prev();
          const promise = new Promise((resolve, reject) => {
            this.cursorFn = (value) => {
              resolve({ value, done: false });
              return new Promise((r) => prev = r);
            };
            this.resolve = () => (this.active = false, resolve({ done: true }));
            this.reject = (x) => (this.active = false, reject(x));
          });
          this.execute();
          return promise;
        },
        return() {
          prev && prev(CLOSE);
          return { done: true };
        }
      })
    };
  }
  describe() {
    this.options.simple = false;
    this.onlyDescribe = this.options.prepare = true;
    return this;
  }
  stream() {
    throw new Error(".stream has been renamed to .forEach");
  }
  forEach(fn) {
    this.forEachFn = fn;
    this.handle();
    return this;
  }
  raw() {
    this.isRaw = true;
    return this;
  }
  values() {
    this.isRaw = "values";
    return this;
  }
  async handle() {
    !this.executed && (this.executed = true) && await 1 && this.handler(this);
  }
  execute() {
    this.handle();
    return this;
  }
  then() {
    this.handle();
    return super.then.apply(this, arguments);
  }
  catch() {
    this.handle();
    return super.catch.apply(this, arguments);
  }
  finally() {
    this.handle();
    return super.finally.apply(this, arguments);
  }
};
function cachedError(xs) {
  if (originCache.has(xs))
    return originCache.get(xs);
  const x = Error.stackTraceLimit;
  Error.stackTraceLimit = 4;
  originCache.set(xs, new Error());
  Error.stackTraceLimit = x;
  return originCache.get(xs);
}

// node_modules/postgres/cf/src/errors.js
var PostgresError = class extends Error {
  constructor(x) {
    super(x.message);
    this.name = this.constructor.name;
    Object.assign(this, x);
  }
};
var Errors = {
  connection,
  postgres,
  generic,
  notSupported
};
function connection(x, options, socket) {
  const { host, port } = socket || options;
  const error = Object.assign(
    new Error("write " + x + " " + (options.path || host + ":" + port)),
    {
      code: x,
      errno: x,
      address: options.path || host
    },
    options.path ? {} : { port }
  );
  Error.captureStackTrace(error, connection);
  return error;
}
function postgres(x) {
  const error = new PostgresError(x);
  Error.captureStackTrace(error, postgres);
  return error;
}
function generic(code, message) {
  const error = Object.assign(new Error(code + ": " + message), { code });
  Error.captureStackTrace(error, generic);
  return error;
}
function notSupported(x) {
  const error = Object.assign(
    new Error(x + " (B) is not supported"),
    {
      code: "MESSAGE_NOT_SUPPORTED",
      name: x
    }
  );
  Error.captureStackTrace(error, notSupported);
  return error;
}

// node_modules/postgres/cf/src/types.js
var types = {
  string: {
    to: 25,
    from: null,
    // defaults to string
    serialize: (x) => "" + x
  },
  number: {
    to: 0,
    from: [21, 23, 26, 700, 701],
    serialize: (x) => "" + x,
    parse: (x) => +x
  },
  json: {
    to: 114,
    from: [114, 3802],
    serialize: (x) => JSON.stringify(x),
    parse: (x) => JSON.parse(x)
  },
  boolean: {
    to: 16,
    from: 16,
    serialize: (x) => x === true ? "t" : "f",
    parse: (x) => x === "t"
  },
  date: {
    to: 1184,
    from: [1082, 1114, 1184],
    serialize: (x) => (x instanceof Date ? x : new Date(x)).toISOString(),
    parse: (x) => new Date(x)
  },
  bytea: {
    to: 17,
    from: 17,
    serialize: (x) => "\\x" + Buffer2.from(x).toString("hex"),
    parse: (x) => Buffer2.from(x.slice(2), "hex")
  }
};
var NotTagged = class {
  then() {
    notTagged();
  }
  catch() {
    notTagged();
  }
  finally() {
    notTagged();
  }
};
var Identifier = class extends NotTagged {
  constructor(value) {
    super();
    this.value = escapeIdentifier(value);
  }
};
var Parameter = class extends NotTagged {
  constructor(value, type, array) {
    super();
    this.value = value;
    this.type = type;
    this.array = array;
  }
};
var Builder = class extends NotTagged {
  constructor(first, rest) {
    super();
    this.first = first;
    this.rest = rest;
  }
  build(before, parameters, types2, options) {
    const keyword = builders.map(([x, fn]) => ({ fn, i: before.search(x) })).sort((a, b2) => a.i - b2.i).pop();
    return keyword.i === -1 ? escapeIdentifiers(this.first, options) : keyword.fn(this.first, this.rest, parameters, types2, options);
  }
};
function handleValue(x, parameters, types2, options) {
  let value = x instanceof Parameter ? x.value : x;
  if (value === void 0) {
    x instanceof Parameter ? x.value = options.transform.undefined : value = x = options.transform.undefined;
    if (value === void 0)
      throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
  }
  return "$" + types2.push(
    x instanceof Parameter ? (parameters.push(x.value), x.array ? x.array[x.type || inferType(x.value)] || x.type || firstIsString(x.value) : x.type) : (parameters.push(x), inferType(x))
  );
}
var defaultHandlers = typeHandlers(types);
function stringify(q, string, value, parameters, types2, options) {
  for (let i = 1; i < q.strings.length; i++) {
    string += stringifyValue(string, value, parameters, types2, options) + q.strings[i];
    value = q.args[i];
  }
  return string;
}
function stringifyValue(string, value, parameters, types2, o) {
  return value instanceof Builder ? value.build(string, parameters, types2, o) : value instanceof Query ? fragment(value, parameters, types2, o) : value instanceof Identifier ? value.value : value && value[0] instanceof Query ? value.reduce((acc, x) => acc + " " + fragment(x, parameters, types2, o), "") : handleValue(value, parameters, types2, o);
}
function fragment(q, parameters, types2, options) {
  q.fragment = true;
  return stringify(q, q.strings[0], q.args[0], parameters, types2, options);
}
function valuesBuilder(first, parameters, types2, columns, options) {
  return first.map(
    (row) => "(" + columns.map(
      (column) => stringifyValue("values", row[column], parameters, types2, options)
    ).join(",") + ")"
  ).join(",");
}
function values(first, rest, parameters, types2, options) {
  const multi = Array.isArray(first[0]);
  const columns = rest.length ? rest.flat() : Object.keys(multi ? first[0] : first);
  return valuesBuilder(multi ? first : [first], parameters, types2, columns, options);
}
function select(first, rest, parameters, types2, options) {
  typeof first === "string" && (first = [first].concat(rest));
  if (Array.isArray(first))
    return escapeIdentifiers(first, options);
  let value;
  const columns = rest.length ? rest.flat() : Object.keys(first);
  return columns.map((x) => {
    value = first[x];
    return (value instanceof Query ? fragment(value, parameters, types2, options) : value instanceof Identifier ? value.value : handleValue(value, parameters, types2, options)) + " as " + escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x);
  }).join(",");
}
var builders = Object.entries({
  values,
  in: (...xs) => {
    const x = values(...xs);
    return x === "()" ? "(null)" : x;
  },
  select,
  as: select,
  returning: select,
  "\\(": select,
  update(first, rest, parameters, types2, options) {
    return (rest.length ? rest.flat() : Object.keys(first)).map(
      (x) => escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x) + "=" + stringifyValue("values", first[x], parameters, types2, options)
    );
  },
  insert(first, rest, parameters, types2, options) {
    const columns = rest.length ? rest.flat() : Object.keys(Array.isArray(first) ? first[0] : first);
    return "(" + escapeIdentifiers(columns, options) + ")values" + valuesBuilder(Array.isArray(first) ? first : [first], parameters, types2, columns, options);
  }
}).map(([x, fn]) => [new RegExp("((?:^|[\\s(])" + x + "(?:$|[\\s(]))(?![\\s\\S]*\\1)", "i"), fn]);
function notTagged() {
  throw Errors.generic("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
}
var serializers = defaultHandlers.serializers;
var parsers = defaultHandlers.parsers;
function firstIsString(x) {
  if (Array.isArray(x))
    return firstIsString(x[0]);
  return typeof x === "string" ? 1009 : 0;
}
var mergeUserTypes = function(types2) {
  const user = typeHandlers(types2 || {});
  return {
    serializers: Object.assign({}, serializers, user.serializers),
    parsers: Object.assign({}, parsers, user.parsers)
  };
};
function typeHandlers(types2) {
  return Object.keys(types2).reduce((acc, k) => {
    types2[k].from && [].concat(types2[k].from).forEach((x) => acc.parsers[x] = types2[k].parse);
    if (types2[k].serialize) {
      acc.serializers[types2[k].to] = types2[k].serialize;
      types2[k].from && [].concat(types2[k].from).forEach((x) => acc.serializers[x] = types2[k].serialize);
    }
    return acc;
  }, { parsers: {}, serializers: {} });
}
function escapeIdentifiers(xs, { transform: { column } }) {
  return xs.map((x) => escapeIdentifier(column.to ? column.to(x) : x)).join(",");
}
var escapeIdentifier = function escape(str) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
};
var inferType = function inferType2(x) {
  return x instanceof Parameter ? x.type : x instanceof Date ? 1184 : x instanceof Uint8Array ? 17 : x === true || x === false ? 16 : typeof x === "bigint" ? 20 : Array.isArray(x) ? inferType2(x[0]) : 0;
};
var escapeBackslash = /\\/g;
var escapeQuote = /"/g;
function arrayEscape(x) {
  return x.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
}
var arraySerializer = function arraySerializer2(xs, serializer, options, typarray) {
  if (Array.isArray(xs) === false)
    return xs;
  if (!xs.length)
    return "{}";
  const first = xs[0];
  const delimiter = typarray === 1020 ? ";" : ",";
  if (Array.isArray(first) && !first.type)
    return "{" + xs.map((x) => arraySerializer2(x, serializer, options, typarray)).join(delimiter) + "}";
  return "{" + xs.map((x) => {
    if (x === void 0) {
      x = options.transform.undefined;
      if (x === void 0)
        throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
    }
    return x === null ? "null" : '"' + arrayEscape(serializer ? serializer(x.type ? x.value : x) : "" + x) + '"';
  }).join(delimiter) + "}";
};
var arrayParserState = {
  i: 0,
  char: null,
  str: "",
  quoted: false,
  last: 0
};
var arrayParser = function arrayParser2(x, parser, typarray) {
  arrayParserState.i = arrayParserState.last = 0;
  return arrayParserLoop(arrayParserState, x, parser, typarray);
};
function arrayParserLoop(s, x, parser, typarray) {
  const xs = [];
  const delimiter = typarray === 1020 ? ";" : ",";
  for (; s.i < x.length; s.i++) {
    s.char = x[s.i];
    if (s.quoted) {
      if (s.char === "\\") {
        s.str += x[++s.i];
      } else if (s.char === '"') {
        xs.push(parser ? parser(s.str) : s.str);
        s.str = "";
        s.quoted = x[s.i + 1] === '"';
        s.last = s.i + 2;
      } else {
        s.str += s.char;
      }
    } else if (s.char === '"') {
      s.quoted = true;
    } else if (s.char === "{") {
      s.last = ++s.i;
      xs.push(arrayParserLoop(s, x, parser, typarray));
    } else if (s.char === "}") {
      s.quoted = false;
      s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
      break;
    } else if (s.char === delimiter && s.p !== "}" && s.p !== '"') {
      xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
    }
    s.p = s.char;
  }
  s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1));
  return xs;
}
var toCamel = (x) => {
  let str = x[0];
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toPascal = (x) => {
  let str = x[0].toUpperCase();
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toKebab = (x) => x.replace(/_/g, "-");
var fromCamel = (x) => x.replace(/([A-Z])/g, "_$1").toLowerCase();
var fromPascal = (x) => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, "_$1")).toLowerCase();
var fromKebab = (x) => x.replace(/-/g, "_");
function createJsonTransform(fn) {
  return function jsonTransform(x, column) {
    return typeof x === "object" && x !== null && (column.type === 114 || column.type === 3802) ? Array.isArray(x) ? x.map((x2) => jsonTransform(x2, column)) : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {}) : x;
  };
}
toCamel.column = { from: toCamel };
toCamel.value = { from: createJsonTransform(toCamel) };
fromCamel.column = { to: fromCamel };
var camel = { ...toCamel };
camel.column.to = fromCamel;
toPascal.column = { from: toPascal };
toPascal.value = { from: createJsonTransform(toPascal) };
fromPascal.column = { to: fromPascal };
var pascal = { ...toPascal };
pascal.column.to = fromPascal;
toKebab.column = { from: toKebab };
toKebab.value = { from: createJsonTransform(toKebab) };
fromKebab.column = { to: fromKebab };
var kebab = { ...toKebab };
kebab.column.to = fromKebab;

// node_modules/postgres/cf/src/connection.js
import { Buffer as Buffer4 } from "node:buffer";
import Stream from "node:stream";

// node_modules/postgres/cf/src/result.js
var Result = class extends Array {
  constructor() {
    super();
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      state: { value: null, writable: true },
      command: { value: null, writable: true },
      columns: { value: null, writable: true },
      statement: { value: null, writable: true }
    });
  }
  static get [Symbol.species]() {
    return Array;
  }
};

// node_modules/postgres/cf/src/queue.js
var queue_default = Queue;
function Queue(initial = []) {
  let xs = initial.slice();
  let index = 0;
  return {
    get length() {
      return xs.length - index;
    },
    remove: (x) => {
      const index2 = xs.indexOf(x);
      return index2 === -1 ? null : (xs.splice(index2, 1), x);
    },
    push: (x) => (xs.push(x), x),
    shift: () => {
      const out = xs[index++];
      if (index === xs.length) {
        index = 0;
        xs = [];
      } else {
        xs[index - 1] = void 0;
      }
      return out;
    }
  };
}

// node_modules/postgres/cf/src/bytes.js
import { Buffer as Buffer3 } from "node:buffer";
var size = 256;
var buffer = Buffer3.allocUnsafe(size);
var messages = "BCcDdEFfHPpQSX".split("").reduce((acc, x) => {
  const v = x.charCodeAt(0);
  acc[x] = () => {
    buffer[0] = v;
    b.i = 5;
    return b;
  };
  return acc;
}, {});
var b = Object.assign(reset, messages, {
  N: String.fromCharCode(0),
  i: 0,
  inc(x) {
    b.i += x;
    return b;
  },
  str(x) {
    const length = Buffer3.byteLength(x);
    fit(length);
    b.i += buffer.write(x, b.i, length, "utf8");
    return b;
  },
  i16(x) {
    fit(2);
    buffer.writeUInt16BE(x, b.i);
    b.i += 2;
    return b;
  },
  i32(x, i) {
    if (i || i === 0) {
      buffer.writeUInt32BE(x, i);
      return b;
    }
    fit(4);
    buffer.writeUInt32BE(x, b.i);
    b.i += 4;
    return b;
  },
  z(x) {
    fit(x);
    buffer.fill(0, b.i, b.i + x);
    b.i += x;
    return b;
  },
  raw(x) {
    buffer = Buffer3.concat([buffer.subarray(0, b.i), x]);
    b.i = buffer.length;
    return b;
  },
  end(at = 1) {
    buffer.writeUInt32BE(b.i - at, at);
    const out = buffer.subarray(0, b.i);
    b.i = 0;
    buffer = Buffer3.allocUnsafe(size);
    return out;
  }
});
var bytes_default = b;
function fit(x) {
  if (buffer.length - b.i < x) {
    const prev = buffer, length = prev.length;
    buffer = Buffer3.allocUnsafe(length + (length >> 1) + x);
    prev.copy(buffer);
  }
}
function reset() {
  b.i = 0;
  return b;
}

// node_modules/postgres/cf/src/connection.js
var connection_default = Connection;
var uid = 1;
var Sync = bytes_default().S().end();
var Flush = bytes_default().H().end();
var SSLRequest = bytes_default().i32(8).i32(80877103).end(8);
var ExecuteUnnamed = Buffer4.concat([bytes_default().E().str(bytes_default.N).i32(0).end(), Sync]);
var DescribeUnnamed = bytes_default().D().str("S").str(bytes_default.N).end();
var noop = () => {
};
var retryRoutines = /* @__PURE__ */ new Set([
  "FetchPreparedStatement",
  "RevalidateCachedQuery",
  "transformAssignedExpr"
]);
var errorFields = {
  83: "severity_local",
  // S
  86: "severity",
  // V
  67: "code",
  // C
  77: "message",
  // M
  68: "detail",
  // D
  72: "hint",
  // H
  80: "position",
  // P
  112: "internal_position",
  // p
  113: "internal_query",
  // q
  87: "where",
  // W
  115: "schema_name",
  // s
  116: "table_name",
  // t
  99: "column_name",
  // c
  100: "data type_name",
  // d
  110: "constraint_name",
  // n
  70: "file",
  // F
  76: "line",
  // L
  82: "routine"
  // R
};
function Connection(options, queues = {}, { onopen = noop, onend = noop, onclose = noop } = {}) {
  const {
    sslnegotiation,
    ssl,
    max,
    user,
    host,
    port,
    database,
    parsers: parsers2,
    transform,
    onnotice,
    onnotify,
    onparameter,
    max_pipeline,
    keep_alive,
    backoff: backoff2,
    target_session_attrs
  } = options;
  const sent = queue_default(), id2 = uid++, backend = { pid: null, secret: null }, idleTimer = timer(end, options.idle_timeout), lifeTimer = timer(end, options.max_lifetime), connectTimer = timer(connectTimedOut, options.connect_timeout);
  let socket = null, cancelMessage, errorResponse = null, result = new Result(), incoming = Buffer4.alloc(0), needsTypes = options.fetch_types, backendParameters = {}, statements = {}, statementId = Math.random().toString(36).slice(2), statementCount = 1, closedTime = 0, remaining = 0, hostIndex = 0, retries = 0, length = 0, delay = 0, rows = 0, serverSignature = null, nextWriteTimer = null, terminated = false, incomings = null, results = null, initial = null, ending = null, stream = null, chunk = null, ended = null, nonce = null, query = null, final = null;
  const connection2 = {
    queue: queues.closed,
    idleTimer,
    connect(query2) {
      initial = query2;
      reconnect();
    },
    terminate,
    execute: execute3,
    cancel,
    end,
    count: 0,
    id: id2
  };
  queues.closed && queues.closed.push(connection2);
  return connection2;
  async function createSocket() {
    let x;
    try {
      x = options.socket ? await Promise.resolve(options.socket(options)) : new net.Socket();
    } catch (e) {
      error(e);
      return;
    }
    x.on("error", error);
    x.on("close", closed);
    x.on("drain", drain);
    return x;
  }
  async function cancel({ pid, secret }, resolve, reject) {
    try {
      cancelMessage = bytes_default().i32(16).i32(80877102).i32(pid).i32(secret).end(16);
      await connect();
      socket.once("error", reject);
      socket.once("close", resolve);
    } catch (error2) {
      reject(error2);
    }
  }
  function execute3(q) {
    if (terminated)
      return queryError(q, Errors.connection("CONNECTION_DESTROYED", options));
    if (stream)
      return queryError(q, Errors.generic("COPY_IN_PROGRESS", "You cannot execute queries during copy"));
    if (q.cancelled)
      return;
    try {
      q.state = backend;
      query ? sent.push(q) : (query = q, query.active = true);
      build(q);
      return write(toBuffer(q)) && !q.describeFirst && !q.cursorFn && sent.length < max_pipeline && (!q.options.onexecute || q.options.onexecute(connection2));
    } catch (error2) {
      sent.length === 0 && write(Sync);
      errored(error2);
      return true;
    }
  }
  function toBuffer(q) {
    if (q.parameters.length >= 65534)
      throw Errors.generic("MAX_PARAMETERS_EXCEEDED", "Max number of parameters (65534) exceeded");
    return q.options.simple ? bytes_default().Q().str(q.statement.string + bytes_default.N).end() : q.describeFirst ? Buffer4.concat([describe(q), Flush]) : q.prepare ? q.prepared ? prepared(q) : Buffer4.concat([describe(q), prepared(q)]) : unnamed(q);
  }
  function describe(q) {
    return Buffer4.concat([
      Parse(q.statement.string, q.parameters, q.statement.types, q.statement.name),
      Describe("S", q.statement.name)
    ]);
  }
  function prepared(q) {
    return Buffer4.concat([
      Bind(q.parameters, q.statement.types, q.statement.name, q.cursorName),
      q.cursorFn ? Execute("", q.cursorRows) : ExecuteUnnamed
    ]);
  }
  function unnamed(q) {
    return Buffer4.concat([
      Parse(q.statement.string, q.parameters, q.statement.types),
      DescribeUnnamed,
      prepared(q)
    ]);
  }
  function build(q) {
    const parameters = [], types2 = [];
    const string = stringify(q, q.strings[0], q.args[0], parameters, types2, options);
    !q.tagged && q.args.forEach((x) => handleValue(x, parameters, types2, options));
    q.prepare = options.prepare && ("prepare" in q.options ? q.options.prepare : true);
    q.string = string;
    q.signature = q.prepare && types2 + string;
    q.onlyDescribe && delete statements[q.signature];
    q.parameters = q.parameters || parameters;
    q.prepared = q.prepare && q.signature in statements;
    q.describeFirst = q.onlyDescribe || parameters.length && !q.prepared;
    q.statement = q.prepared ? statements[q.signature] : { string, types: types2, name: q.prepare ? statementId + statementCount++ : "" };
    typeof options.debug === "function" && options.debug(id2, string, parameters, types2);
  }
  function write(x, fn) {
    chunk = chunk ? Buffer4.concat([chunk, x]) : Buffer4.from(x);
    if (fn || chunk.length >= 1024)
      return nextWrite(fn);
    nextWriteTimer === null && (nextWriteTimer = setImmediate(nextWrite));
    return true;
  }
  function nextWrite(fn) {
    const x = socket.write(chunk, fn);
    nextWriteTimer !== null && clearImmediate(nextWriteTimer);
    chunk = nextWriteTimer = null;
    return x;
  }
  function connectTimedOut() {
    errored(Errors.connection("CONNECT_TIMEOUT", options, socket));
    socket.destroy();
  }
  async function secure() {
    if (sslnegotiation !== "direct") {
      write(SSLRequest);
      const canSSL = await new Promise((r) => socket.once("data", (x) => r(x[0] === 83)));
      if (!canSSL && ssl === "prefer")
        return connected();
    }
    const options2 = {
      socket,
      servername: net.isIP(socket.host) ? void 0 : socket.host
    };
    if (sslnegotiation === "direct")
      options2.ALPNProtocols = ["postgresql"];
    if (ssl === "require" || ssl === "allow" || ssl === "prefer")
      options2.rejectUnauthorized = false;
    else if (typeof ssl === "object")
      Object.assign(options2, ssl);
    socket.removeAllListeners();
    socket = tls.connect(options2);
    socket.on("secureConnect", connected);
    socket.on("error", error);
    socket.on("close", closed);
    socket.on("drain", drain);
  }
  function drain() {
    !query && onopen(connection2);
  }
  function data(x) {
    if (incomings) {
      incomings.push(x);
      remaining -= x.length;
      if (remaining > 0)
        return;
    }
    incoming = incomings ? Buffer4.concat(incomings, length - remaining) : incoming.length === 0 ? x : Buffer4.concat([incoming, x], incoming.length + x.length);
    while (incoming.length > 4) {
      length = incoming.readUInt32BE(1);
      if (length >= incoming.length) {
        remaining = length - incoming.length;
        incomings = [incoming];
        break;
      }
      try {
        handle(incoming.subarray(0, length + 1));
      } catch (e) {
        query && (query.cursorFn || query.describeFirst) && write(Sync);
        errored(e);
      }
      incoming = incoming.subarray(length + 1);
      remaining = 0;
      incomings = null;
    }
  }
  async function connect() {
    terminated = false;
    backendParameters = {};
    socket || (socket = await createSocket());
    if (!socket)
      return;
    connectTimer.start();
    if (options.socket)
      return ssl ? secure() : connected();
    socket.on("connect", ssl ? secure : connected);
    if (options.path)
      return socket.connect(options.path);
    socket.ssl = ssl;
    socket.connect(port[hostIndex], host[hostIndex]);
    socket.host = host[hostIndex];
    socket.port = port[hostIndex];
    hostIndex = (hostIndex + 1) % port.length;
  }
  function reconnect() {
    setTimeout(connect, closedTime ? Math.max(0, closedTime + delay - performance.now()) : 0);
  }
  function connected() {
    try {
      statements = {};
      needsTypes = options.fetch_types;
      statementId = Math.random().toString(36).slice(2);
      statementCount = 1;
      lifeTimer.start();
      socket.on("data", data);
      keep_alive && socket.setKeepAlive && socket.setKeepAlive(true, 1e3 * keep_alive);
      const s = StartupMessage();
      write(s);
    } catch (err) {
      error(err);
    }
  }
  function error(err) {
    if (connection2.queue === queues.connecting && options.host[retries + 1])
      return;
    errored(err);
    while (sent.length)
      queryError(sent.shift(), err);
  }
  function errored(err) {
    stream && (stream.destroy(err), stream = null);
    query && queryError(query, err);
    initial && (queryError(initial, err), initial = null);
  }
  function queryError(query2, err) {
    if (query2.reserve)
      return query2.reject(err);
    if (!err || typeof err !== "object")
      err = new Error(err);
    "query" in err || "parameters" in err || Object.defineProperties(err, {
      stack: { value: err.stack + query2.origin.replace(/.*\n/, "\n"), enumerable: options.debug },
      query: { value: query2.string, enumerable: options.debug },
      parameters: { value: query2.parameters, enumerable: options.debug },
      args: { value: query2.args, enumerable: options.debug },
      types: { value: query2.statement && query2.statement.types, enumerable: options.debug }
    });
    query2.reject(err);
  }
  function end() {
    return ending || (!connection2.reserved && onend(connection2), !connection2.reserved && !initial && !query && sent.length === 0 ? (terminate(), new Promise((r) => socket && socket.readyState !== "closed" ? socket.once("close", r) : r())) : ending = new Promise((r) => ended = r));
  }
  function terminate() {
    terminated = true;
    if (stream || query || initial || sent.length)
      error(Errors.connection("CONNECTION_DESTROYED", options));
    clearImmediate(nextWriteTimer);
    if (socket) {
      socket.removeListener("data", data);
      socket.removeListener("connect", connected);
      socket.readyState === "open" && socket.end(bytes_default().X().end());
    }
    ended && (ended(), ending = ended = null);
  }
  async function closed(hadError) {
    incoming = Buffer4.alloc(0);
    remaining = 0;
    incomings = null;
    clearImmediate(nextWriteTimer);
    socket.removeListener("data", data);
    socket.removeListener("connect", connected);
    idleTimer.cancel();
    lifeTimer.cancel();
    connectTimer.cancel();
    socket.removeAllListeners();
    socket = null;
    if (initial)
      return reconnect();
    !hadError && (query || sent.length) && error(Errors.connection("CONNECTION_CLOSED", options, socket));
    closedTime = performance.now();
    hadError && options.shared.retries++;
    delay = (typeof backoff2 === "function" ? backoff2(options.shared.retries) : backoff2) * 1e3;
    onclose(connection2, Errors.connection("CONNECTION_CLOSED", options, socket));
  }
  function handle(xs, x = xs[0]) {
    (x === 68 ? DataRow : (
      // D
      x === 100 ? CopyData : (
        // d
        x === 65 ? NotificationResponse : (
          // A
          x === 83 ? ParameterStatus : (
            // S
            x === 90 ? ReadyForQuery : (
              // Z
              x === 67 ? CommandComplete : (
                // C
                x === 50 ? BindComplete : (
                  // 2
                  x === 49 ? ParseComplete : (
                    // 1
                    x === 116 ? ParameterDescription : (
                      // t
                      x === 84 ? RowDescription : (
                        // T
                        x === 82 ? Authentication : (
                          // R
                          x === 110 ? NoData : (
                            // n
                            x === 75 ? BackendKeyData : (
                              // K
                              x === 69 ? ErrorResponse : (
                                // E
                                x === 115 ? PortalSuspended : (
                                  // s
                                  x === 51 ? CloseComplete : (
                                    // 3
                                    x === 71 ? CopyInResponse : (
                                      // G
                                      x === 78 ? NoticeResponse : (
                                        // N
                                        x === 72 ? CopyOutResponse : (
                                          // H
                                          x === 99 ? CopyDone : (
                                            // c
                                            x === 73 ? EmptyQueryResponse : (
                                              // I
                                              x === 86 ? FunctionCallResponse : (
                                                // V
                                                x === 118 ? NegotiateProtocolVersion : (
                                                  // v
                                                  x === 87 ? CopyBothResponse : (
                                                    // W
                                                    /* c8 ignore next */
                                                    UnknownMessage
                                                  )
                                                )
                                              )
                                            )
                                          )
                                        )
                                      )
                                    )
                                  )
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    ))(xs);
  }
  function DataRow(x) {
    let index = 7;
    let length2;
    let column;
    let value;
    const row = query.isRaw ? new Array(query.statement.columns.length) : {};
    for (let i = 0; i < query.statement.columns.length; i++) {
      column = query.statement.columns[i];
      length2 = x.readInt32BE(index);
      index += 4;
      value = length2 === -1 ? null : query.isRaw === true ? x.subarray(index, index += length2) : column.parser === void 0 ? x.toString("utf8", index, index += length2) : column.parser.array === true ? column.parser(x.toString("utf8", index + 1, index += length2)) : column.parser(x.toString("utf8", index, index += length2));
      query.isRaw ? row[i] = query.isRaw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
    }
    query.forEachFn ? query.forEachFn(transform.row.from ? transform.row.from(row) : row, result) : result[rows++] = transform.row.from ? transform.row.from(row) : row;
  }
  function ParameterStatus(x) {
    const [k, v] = x.toString("utf8", 5, x.length - 1).split(bytes_default.N);
    backendParameters[k] = v;
    if (options.parameters[k] !== v) {
      options.parameters[k] = v;
      onparameter && onparameter(k, v);
    }
  }
  function ReadyForQuery(x) {
    if (query) {
      if (errorResponse) {
        query.retried ? errored(query.retried) : query.prepared && retryRoutines.has(errorResponse.routine) ? retry(query, errorResponse) : errored(errorResponse);
      } else {
        query.resolve(results || result);
      }
    } else if (errorResponse) {
      errored(errorResponse);
    }
    query = results = errorResponse = null;
    result = new Result();
    connectTimer.cancel();
    if (initial) {
      if (target_session_attrs) {
        if (!backendParameters.in_hot_standby || !backendParameters.default_transaction_read_only)
          return fetchState();
        else if (tryNext(target_session_attrs, backendParameters))
          return terminate();
      }
      if (needsTypes) {
        initial.reserve && (initial = null);
        return fetchArrayTypes();
      }
      initial && !initial.reserve && execute3(initial);
      options.shared.retries = retries = 0;
      initial = null;
      return;
    }
    while (sent.length && (query = sent.shift()) && (query.active = true, query.cancelled))
      Connection(options).cancel(query.state, query.cancelled.resolve, query.cancelled.reject);
    if (query)
      return;
    connection2.reserved ? !connection2.reserved.release && x[5] === 73 ? ending ? terminate() : (connection2.reserved = null, onopen(connection2)) : connection2.reserved() : ending ? terminate() : onopen(connection2);
  }
  function CommandComplete(x) {
    rows = 0;
    for (let i = x.length - 1; i > 0; i--) {
      if (x[i] === 32 && x[i + 1] < 58 && result.count === null)
        result.count = +x.toString("utf8", i + 1, x.length - 1);
      if (x[i - 1] >= 65) {
        result.command = x.toString("utf8", 5, i);
        result.state = backend;
        break;
      }
    }
    final && (final(), final = null);
    if (result.command === "BEGIN" && max !== 1 && !connection2.reserved)
      return errored(Errors.generic("UNSAFE_TRANSACTION", "Only use sql.begin, sql.reserved or max: 1"));
    if (query.options.simple)
      return BindComplete();
    if (query.cursorFn) {
      result.count && query.cursorFn(result);
      write(Sync);
    }
  }
  function ParseComplete() {
    query.parsing = false;
  }
  function BindComplete() {
    !result.statement && (result.statement = query.statement);
    result.columns = query.statement.columns;
  }
  function ParameterDescription(x) {
    const length2 = x.readUInt16BE(5);
    for (let i = 0; i < length2; ++i)
      !query.statement.types[i] && (query.statement.types[i] = x.readUInt32BE(7 + i * 4));
    query.prepare && (statements[query.signature] = query.statement);
    query.describeFirst && !query.onlyDescribe && (write(prepared(query)), query.describeFirst = false);
  }
  function RowDescription(x) {
    if (result.command) {
      results = results || [result];
      results.push(result = new Result());
      result.count = null;
      query.statement.columns = null;
    }
    const length2 = x.readUInt16BE(5);
    let index = 7;
    let start;
    query.statement.columns = Array(length2);
    for (let i = 0; i < length2; ++i) {
      start = index;
      while (x[index++] !== 0) ;
      const table = x.readUInt32BE(index);
      const number = x.readUInt16BE(index + 4);
      const type = x.readUInt32BE(index + 6);
      query.statement.columns[i] = {
        name: transform.column.from ? transform.column.from(x.toString("utf8", start, index - 1)) : x.toString("utf8", start, index - 1),
        parser: parsers2[type],
        table,
        number,
        type
      };
      index += 18;
    }
    result.statement = query.statement;
    if (query.onlyDescribe)
      return query.resolve(query.statement), write(Sync);
  }
  async function Authentication(x, type = x.readUInt32BE(5)) {
    (type === 3 ? AuthenticationCleartextPassword : type === 5 ? AuthenticationMD5Password : type === 10 ? SASL : type === 11 ? SASLContinue : type === 12 ? SASLFinal : type !== 0 ? UnknownAuth : noop)(x, type);
  }
  async function AuthenticationCleartextPassword() {
    const payload = await Pass();
    write(
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function AuthenticationMD5Password(x) {
    const payload = "md5" + await md5(
      Buffer4.concat([
        Buffer4.from(await md5(await Pass() + user)),
        x.subarray(9)
      ])
    );
    write(
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function SASL() {
    nonce = (await crypto2.randomBytes(18)).toString("base64");
    bytes_default().p().str("SCRAM-SHA-256" + bytes_default.N);
    const i = bytes_default.i;
    write(bytes_default.inc(4).str("n,,n=*,r=" + nonce).i32(bytes_default.i - i - 4, i).end());
  }
  async function SASLContinue(x) {
    const res = x.toString("utf8", 9).split(",").reduce((acc, x2) => (acc[x2[0]] = x2.slice(2), acc), {});
    const saltedPassword = await crypto2.pbkdf2Sync(
      await Pass(),
      Buffer4.from(res.s, "base64"),
      parseInt(res.i),
      32,
      "sha256"
    );
    const clientKey = await hmac(saltedPassword, "Client Key");
    const auth = "n=*,r=" + nonce + ",r=" + res.r + ",s=" + res.s + ",i=" + res.i + ",c=biws,r=" + res.r;
    serverSignature = (await hmac(await hmac(saltedPassword, "Server Key"), auth)).toString("base64");
    const payload = "c=biws,r=" + res.r + ",p=" + xor(
      clientKey,
      Buffer4.from(await hmac(await sha256(clientKey), auth))
    ).toString("base64");
    write(
      bytes_default().p().str(payload).end()
    );
  }
  function SASLFinal(x) {
    if (x.toString("utf8", 9).split(bytes_default.N, 1)[0].slice(2) === serverSignature)
      return;
    errored(Errors.generic("SASL_SIGNATURE_MISMATCH", "The server did not return the correct signature"));
    socket.destroy();
  }
  function Pass() {
    return Promise.resolve(
      typeof options.pass === "function" ? options.pass() : options.pass
    );
  }
  function NoData() {
    result.statement = query.statement;
    result.statement.columns = [];
    if (query.onlyDescribe)
      return query.resolve(query.statement), write(Sync);
  }
  function BackendKeyData(x) {
    backend.pid = x.readUInt32BE(5);
    backend.secret = x.readUInt32BE(9);
  }
  async function fetchArrayTypes() {
    needsTypes = false;
    const types2 = await new Query([`
      select b.oid, b.typarray
      from pg_catalog.pg_type a
      left join pg_catalog.pg_type b on b.oid = a.typelem
      where a.typcategory = 'A'
      group by b.oid, b.typarray
      order by b.oid
    `], [], execute3);
    types2.forEach(({ oid, typarray }) => addArrayType(oid, typarray));
  }
  function addArrayType(oid, typarray) {
    if (!!options.parsers[typarray] && !!options.serializers[typarray]) return;
    const parser = options.parsers[oid];
    options.shared.typeArrayMap[oid] = typarray;
    options.parsers[typarray] = (xs) => arrayParser(xs, parser, typarray);
    options.parsers[typarray].array = true;
    options.serializers[typarray] = (xs) => arraySerializer(xs, options.serializers[oid], options, typarray);
  }
  function tryNext(x, xs) {
    return x === "read-write" && xs.default_transaction_read_only === "on" || x === "read-only" && xs.default_transaction_read_only === "off" || x === "primary" && xs.in_hot_standby === "on" || x === "standby" && xs.in_hot_standby === "off" || x === "prefer-standby" && xs.in_hot_standby === "off" && options.host[retries];
  }
  function fetchState() {
    const query2 = new Query([`
      show transaction_read_only;
      select pg_catalog.pg_is_in_recovery()
    `], [], execute3, null, { simple: true });
    query2.resolve = ([[a], [b2]]) => {
      backendParameters.default_transaction_read_only = a.transaction_read_only;
      backendParameters.in_hot_standby = b2.pg_is_in_recovery ? "on" : "off";
    };
    query2.execute();
  }
  function ErrorResponse(x) {
    if (query) {
      (query.cursorFn || query.describeFirst) && write(Sync);
      errorResponse = Errors.postgres(parseError(x));
    } else {
      errored(Errors.postgres(parseError(x)));
    }
  }
  function retry(q, error2) {
    delete statements[q.signature];
    q.retried = error2;
    execute3(q);
  }
  function NotificationResponse(x) {
    if (!onnotify)
      return;
    let index = 9;
    while (x[index++] !== 0) ;
    onnotify(
      x.toString("utf8", 9, index - 1),
      x.toString("utf8", index, x.length - 1)
    );
  }
  async function PortalSuspended() {
    try {
      const x = await Promise.resolve(query.cursorFn(result));
      rows = 0;
      x === CLOSE ? write(Close(query.portal)) : (result = new Result(), write(Execute("", query.cursorRows)));
    } catch (err) {
      write(Sync);
      query.reject(err);
    }
  }
  function CloseComplete() {
    result.count && query.cursorFn(result);
    query.resolve(result);
  }
  function CopyInResponse() {
    stream = new Stream.Writable({
      autoDestroy: true,
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
        stream = null;
      }
    });
    query.resolve(stream);
  }
  function CopyOutResponse() {
    stream = new Stream.Readable({
      read() {
        socket.resume();
      }
    });
    query.resolve(stream);
  }
  function CopyBothResponse() {
    stream = new Stream.Duplex({
      autoDestroy: true,
      read() {
        socket.resume();
      },
      /* c8 ignore next 11 */
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
      }
    });
    query.resolve(stream);
  }
  function CopyData(x) {
    stream && (stream.push(x.subarray(5)) || socket.pause());
  }
  function CopyDone() {
    stream && stream.push(null);
    stream = null;
  }
  function NoticeResponse(x) {
    onnotice ? onnotice(parseError(x)) : console.log(parseError(x));
  }
  function EmptyQueryResponse() {
  }
  function FunctionCallResponse() {
    errored(Errors.notSupported("FunctionCallResponse"));
  }
  function NegotiateProtocolVersion() {
    errored(Errors.notSupported("NegotiateProtocolVersion"));
  }
  function UnknownMessage(x) {
    console.error("Postgres.js : Unknown Message:", x[0]);
  }
  function UnknownAuth(x, type) {
    console.error("Postgres.js : Unknown Auth:", type);
  }
  function Bind(parameters, types2, statement = "", portal = "") {
    let prev, type;
    bytes_default().B().str(portal + bytes_default.N).str(statement + bytes_default.N).i16(0).i16(parameters.length);
    parameters.forEach((x, i) => {
      if (x === null)
        return bytes_default.i32(4294967295);
      type = types2[i];
      parameters[i] = x = type in options.serializers ? options.serializers[type](x) : "" + x;
      prev = bytes_default.i;
      bytes_default.inc(4).str(x).i32(bytes_default.i - prev - 4, prev);
    });
    bytes_default.i16(0);
    return bytes_default.end();
  }
  function Parse(str, parameters, types2, name = "") {
    bytes_default().P().str(name + bytes_default.N).str(str + bytes_default.N).i16(parameters.length);
    parameters.forEach((x, i) => bytes_default.i32(types2[i] || 0));
    return bytes_default.end();
  }
  function Describe(x, name = "") {
    return bytes_default().D().str(x).str(name + bytes_default.N).end();
  }
  function Execute(portal = "", rows2 = 0) {
    return Buffer4.concat([
      bytes_default().E().str(portal + bytes_default.N).i32(rows2).end(),
      Flush
    ]);
  }
  function Close(portal = "") {
    return Buffer4.concat([
      bytes_default().C().str("P").str(portal + bytes_default.N).end(),
      bytes_default().S().end()
    ]);
  }
  function StartupMessage() {
    return cancelMessage || bytes_default().inc(4).i16(3).z(2).str(
      Object.entries(Object.assign(
        {
          user,
          database,
          client_encoding: "UTF8"
        },
        options.connection
      )).filter(([, v]) => v).map(([k, v]) => k + bytes_default.N + v).join(bytes_default.N)
    ).z(2).end(0);
  }
}
function parseError(x) {
  const error = {};
  let start = 5;
  for (let i = 5; i < x.length - 1; i++) {
    if (x[i] === 0) {
      error[errorFields[x[start]]] = x.toString("utf8", start + 1, i);
      start = i + 1;
    }
  }
  return error;
}
function md5(x) {
  return crypto2.createHash("md5").update(x).digest("hex");
}
function hmac(key, x) {
  return crypto2.createHmac("sha256", key).update(x).digest();
}
function sha256(x) {
  return crypto2.createHash("sha256").update(x).digest();
}
function xor(a, b2) {
  const length = Math.max(a.length, b2.length);
  const buffer2 = Buffer4.allocUnsafe(length);
  for (let i = 0; i < length; i++)
    buffer2[i] = a[i] ^ b2[i];
  return buffer2;
}
function timer(fn, seconds) {
  seconds = typeof seconds === "function" ? seconds() : seconds;
  if (!seconds)
    return { cancel: noop, start: noop };
  let timer2;
  return {
    cancel() {
      timer2 && (clearTimeout(timer2), timer2 = null);
    },
    start() {
      timer2 && clearTimeout(timer2);
      timer2 = setTimeout(done, seconds * 1e3, arguments);
    }
  };
  function done(args) {
    fn.apply(null, args);
    timer2 = null;
  }
}

// node_modules/postgres/cf/src/subscribe.js
import { Buffer as Buffer5 } from "node:buffer";
var noop2 = () => {
};
function Subscribe(postgres2, options) {
  const subscribers = /* @__PURE__ */ new Map(), slot = "postgresjs_" + Math.random().toString(36).slice(2), state = {};
  let connection2, stream, ended = false;
  const sql = subscribe.sql = postgres2({
    ...options,
    transform: { column: {}, value: {}, row: {} },
    max: 1,
    fetch_types: false,
    idle_timeout: null,
    max_lifetime: null,
    connection: {
      ...options.connection,
      replication: "database"
    },
    onclose: async function() {
      if (ended)
        return;
      stream = null;
      state.pid = state.secret = void 0;
      connected(await init(sql, slot, options.publications));
      subscribers.forEach((event) => event.forEach(({ onsubscribe }) => onsubscribe()));
    },
    no_subscribe: true
  });
  const end = sql.end, close = sql.close;
  sql.end = async () => {
    ended = true;
    stream && await new Promise((r) => (stream.once("close", r), stream.end()));
    return end();
  };
  sql.close = async () => {
    stream && await new Promise((r) => (stream.once("close", r), stream.end()));
    return close();
  };
  return subscribe;
  async function subscribe(event, fn, onsubscribe = noop2, onerror = noop2) {
    event = parseEvent(event);
    if (!connection2)
      connection2 = init(sql, slot, options.publications);
    const subscriber = { fn, onsubscribe };
    const fns = subscribers.has(event) ? subscribers.get(event).add(subscriber) : subscribers.set(event, /* @__PURE__ */ new Set([subscriber])).get(event);
    const unsubscribe = () => {
      fns.delete(subscriber);
      fns.size === 0 && subscribers.delete(event);
    };
    return connection2.then((x) => {
      connected(x);
      onsubscribe();
      stream && stream.on("error", onerror);
      return { unsubscribe, state, sql };
    });
  }
  function connected(x) {
    stream = x.stream;
    state.pid = x.state.pid;
    state.secret = x.state.secret;
  }
  async function init(sql2, slot2, publications) {
    if (!publications)
      throw new Error("Missing publication names");
    const xs = await sql2.unsafe(
      `CREATE_REPLICATION_SLOT ${slot2} TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`
    );
    const [x] = xs;
    const stream2 = await sql2.unsafe(
      `START_REPLICATION SLOT ${slot2} LOGICAL ${x.consistent_point} (proto_version '1', publication_names '${publications}')`
    ).writable();
    const state2 = {
      lsn: Buffer5.concat(x.consistent_point.split("/").map((x2) => Buffer5.from(("00000000" + x2).slice(-8), "hex")))
    };
    stream2.on("data", data);
    stream2.on("error", error);
    stream2.on("close", sql2.close);
    return { stream: stream2, state: xs.state };
    function error(e) {
      console.error("Unexpected error during logical streaming - reconnecting", e);
    }
    function data(x2) {
      if (x2[0] === 119) {
        parse(x2.subarray(25), state2, sql2.options.parsers, handle, options.transform);
      } else if (x2[0] === 107 && x2[17]) {
        state2.lsn = x2.subarray(1, 9);
        pong();
      }
    }
    function handle(a, b2) {
      const path = b2.relation.schema + "." + b2.relation.table;
      call("*", a, b2);
      call("*:" + path, a, b2);
      b2.relation.keys.length && call("*:" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
      call(b2.command, a, b2);
      call(b2.command + ":" + path, a, b2);
      b2.relation.keys.length && call(b2.command + ":" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
    }
    function pong() {
      const x2 = Buffer5.alloc(34);
      x2[0] = "r".charCodeAt(0);
      x2.fill(state2.lsn, 1);
      x2.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2e3, 0, 1)) * BigInt(1e3), 25);
      stream2.write(x2);
    }
  }
  function call(x, a, b2) {
    subscribers.has(x) && subscribers.get(x).forEach(({ fn }) => fn(a, b2, x));
  }
}
function Time(x) {
  return new Date(Date.UTC(2e3, 0, 1) + Number(x / BigInt(1e3)));
}
function parse(x, state, parsers2, handle, transform) {
  const char = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc);
  Object.entries({
    R: (x2) => {
      let i = 1;
      const r = state[x2.readUInt32BE(i)] = {
        schema: x2.toString("utf8", i += 4, i = x2.indexOf(0, i)) || "pg_catalog",
        table: x2.toString("utf8", i + 1, i = x2.indexOf(0, i + 1)),
        columns: Array(x2.readUInt16BE(i += 2)),
        keys: []
      };
      i += 2;
      let columnIndex = 0, column;
      while (i < x2.length) {
        column = r.columns[columnIndex++] = {
          key: x2[i++],
          name: transform.column.from ? transform.column.from(x2.toString("utf8", i, i = x2.indexOf(0, i))) : x2.toString("utf8", i, i = x2.indexOf(0, i)),
          type: x2.readUInt32BE(i += 1),
          parser: parsers2[x2.readUInt32BE(i)],
          atttypmod: x2.readUInt32BE(i += 4)
        };
        column.key && r.keys.push(column);
        i += 4;
      }
    },
    Y: () => {
    },
    // Type
    O: () => {
    },
    // Origin
    B: (x2) => {
      state.date = Time(x2.readBigInt64BE(9));
      state.lsn = x2.subarray(1, 9);
    },
    I: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      const { row } = tuples(x2, relation.columns, i += 7, transform);
      handle(row, {
        command: "insert",
        relation
      });
    },
    D: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      i += 4;
      const key = x2[i] === 75;
      handle(
        key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform).row : null,
        {
          command: "delete",
          relation,
          key
        }
      );
    },
    U: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      i += 4;
      const key = x2[i] === 75;
      const xs = key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform) : null;
      xs && (i = xs.i);
      const { row } = tuples(x2, relation.columns, i + 3, transform);
      handle(row, {
        command: "update",
        relation,
        key,
        old: xs && xs.row
      });
    },
    T: () => {
    },
    // Truncate,
    C: () => {
    }
    // Commit
  }).reduce(char, {})[x[0]](x);
}
function tuples(x, columns, xi, transform) {
  let type, column, value;
  const row = transform.raw ? new Array(columns.length) : {};
  for (let i = 0; i < columns.length; i++) {
    type = x[xi++];
    column = columns[i];
    value = type === 110 ? null : type === 117 ? void 0 : column.parser === void 0 ? x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)) : column.parser.array === true ? column.parser(x.toString("utf8", xi + 5, xi += 4 + x.readUInt32BE(xi))) : column.parser(x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)));
    transform.raw ? row[i] = transform.raw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
  }
  return { i: xi, row: transform.row.from ? transform.row.from(row) : row };
}
function parseEvent(x) {
  const xs = x.match(/^(\*|insert|update|delete)?:?([^.]+?\.?[^=]+)?=?(.+)?/i) || [];
  if (!xs)
    throw new Error("Malformed subscribe pattern: " + x);
  const [, command, path, key] = xs;
  return (command || "*") + (path ? ":" + (path.indexOf(".") === -1 ? "public." + path : path) : "") + (key ? "=" + key : "");
}

// node_modules/postgres/cf/src/large.js
import Stream2 from "node:stream";
function largeObject(sql, oid, mode = 131072 | 262144) {
  return new Promise(async (resolve, reject) => {
    await sql.begin(async (sql2) => {
      let finish;
      !oid && ([{ oid }] = await sql2`select lo_creat(-1) as oid`);
      const [{ fd }] = await sql2`select lo_open(${oid}, ${mode}) as fd`;
      const lo = {
        writable,
        readable,
        close: () => sql2`select lo_close(${fd})`.then(finish),
        tell: () => sql2`select lo_tell64(${fd})`,
        read: (x) => sql2`select loread(${fd}, ${x}) as data`,
        write: (x) => sql2`select lowrite(${fd}, ${x})`,
        truncate: (x) => sql2`select lo_truncate64(${fd}, ${x})`,
        seek: (x, whence = 0) => sql2`select lo_lseek64(${fd}, ${x}, ${whence})`,
        size: () => sql2`
          select
            lo_lseek64(${fd}, location, 0) as position,
            seek.size
          from (
            select
              lo_lseek64($1, 0, 2) as size,
              tell.location
            from (select lo_tell64($1) as location) tell
          ) seek
        `
      };
      resolve(lo);
      return new Promise(async (r) => finish = r);
      async function readable({
        highWaterMark = 2048 * 8,
        start = 0,
        end = Infinity
      } = {}) {
        let max = end - start;
        start && await lo.seek(start);
        return new Stream2.Readable({
          highWaterMark,
          async read(size2) {
            const l = size2 > max ? size2 - max : size2;
            max -= size2;
            const [{ data }] = await lo.read(l);
            this.push(data);
            if (data.length < size2)
              this.push(null);
          }
        });
      }
      async function writable({
        highWaterMark = 2048 * 8,
        start = 0
      } = {}) {
        start && await lo.seek(start);
        return new Stream2.Writable({
          highWaterMark,
          write(chunk, encoding, callback) {
            lo.write(chunk).then(() => callback(), callback);
          }
        });
      }
    }).catch(reject);
  });
}

// node_modules/postgres/cf/src/index.js
Object.assign(Postgres, {
  PostgresError,
  toPascal,
  pascal,
  toCamel,
  camel,
  toKebab,
  kebab,
  fromPascal,
  fromCamel,
  fromKebab,
  BigInt: {
    to: 20,
    from: [20],
    parse: (x) => BigInt(x),
    // eslint-disable-line
    serialize: (x) => x.toString()
  }
});
var src_default = Postgres;
function Postgres(a, b2) {
  const options = parseOptions(a, b2), subscribe = options.no_subscribe || Subscribe(Postgres, { ...options });
  let ending = false;
  const queries2 = queue_default(), connecting = queue_default(), reserved = queue_default(), closed = queue_default(), ended = queue_default(), open = queue_default(), busy = queue_default(), full = queue_default(), queues = { connecting, reserved, closed, ended, open, busy, full };
  const connections = [...Array(options.max)].map(() => connection_default(options, queues, { onopen, onend, onclose }));
  const sql = Sql(handler);
  Object.assign(sql, {
    get parameters() {
      return options.parameters;
    },
    largeObject: largeObject.bind(null, sql),
    subscribe,
    CLOSE,
    END: CLOSE,
    PostgresError,
    options,
    reserve,
    listen,
    begin,
    close,
    end
  });
  return sql;
  function Sql(handler2) {
    handler2.debug = options.debug;
    Object.entries(options.types).reduce((acc, [name, type]) => {
      acc[name] = (x) => new Parameter(x, type.to);
      return acc;
    }, typed);
    Object.assign(sql2, {
      types: typed,
      typed,
      unsafe,
      notify,
      array,
      json,
      file
    });
    return sql2;
    function typed(value, type) {
      return new Parameter(value, type);
    }
    function sql2(strings, ...args) {
      const query = strings && Array.isArray(strings.raw) ? new Query(strings, args, handler2, cancel) : typeof strings === "string" && !args.length ? new Identifier(options.transform.column.to ? options.transform.column.to(strings) : strings) : new Builder(strings, args);
      return query;
    }
    function unsafe(string, args = [], options2 = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
      const query = new Query([string], args, handler2, cancel, {
        prepare: false,
        ...options2,
        simple: "simple" in options2 ? options2.simple : args.length === 0
      });
      return query;
    }
    function file(path, args = [], options2 = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
      const query = new Query([], args, (query2) => {
        fs.readFile(path, "utf8", (err, string) => {
          if (err)
            return query2.reject(err);
          query2.strings = [string];
          handler2(query2);
        });
      }, cancel, {
        ...options2,
        simple: "simple" in options2 ? options2.simple : args.length === 0
      });
      return query;
    }
  }
  async function listen(name, fn, onlisten) {
    const listener = { fn, onlisten };
    const sql2 = listen.sql || (listen.sql = Postgres({
      ...options,
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      fetch_types: false,
      onclose() {
        Object.entries(listen.channels).forEach(([name2, { listeners }]) => {
          delete listen.channels[name2];
          Promise.all(listeners.map((l) => listen(name2, l.fn, l.onlisten).catch(() => {
          })));
        });
      },
      onnotify(c, x) {
        c in listen.channels && listen.channels[c].listeners.forEach((l) => l.fn(x));
      }
    }));
    const channels = listen.channels || (listen.channels = {}), exists = name in channels;
    if (exists) {
      channels[name].listeners.push(listener);
      const result2 = await channels[name].result;
      listener.onlisten && listener.onlisten();
      return { state: result2.state, unlisten };
    }
    channels[name] = { result: sql2`listen ${sql2.unsafe('"' + name.replace(/"/g, '""') + '"')}`, listeners: [listener] };
    const result = await channels[name].result;
    listener.onlisten && listener.onlisten();
    return { state: result.state, unlisten };
    async function unlisten() {
      if (name in channels === false)
        return;
      channels[name].listeners = channels[name].listeners.filter((x) => x !== listener);
      if (channels[name].listeners.length)
        return;
      delete channels[name];
      return sql2`unlisten ${sql2.unsafe('"' + name.replace(/"/g, '""') + '"')}`;
    }
  }
  async function notify(channel, payload) {
    return await sql`select pg_notify(${channel}, ${"" + payload})`;
  }
  async function reserve() {
    const queue = queue_default();
    const c = open.length ? open.shift() : await new Promise((resolve, reject) => {
      const query = { reserve: resolve, reject };
      queries2.push(query);
      closed.length && connect(closed.shift(), query);
    });
    move(c, reserved);
    c.reserved = () => queue.length ? c.execute(queue.shift()) : move(c, reserved);
    c.reserved.release = true;
    const sql2 = Sql(handler2);
    sql2.release = () => {
      c.reserved = null;
      onopen(c);
    };
    return sql2;
    function handler2(q) {
      c.queue === full ? queue.push(q) : c.execute(q) || move(c, full);
    }
  }
  async function begin(options2, fn) {
    !fn && (fn = options2, options2 = "");
    const queries3 = queue_default();
    let savepoints = 0, connection2, prepare = null;
    try {
      await sql.unsafe("begin " + options2.replace(/[^a-z ]/ig, ""), [], { onexecute }).execute();
      return await Promise.race([
        scope(connection2, fn),
        new Promise((_, reject) => connection2.onclose = reject)
      ]);
    } catch (error) {
      throw error;
    }
    async function scope(c, fn2, name) {
      const sql2 = Sql(handler2);
      sql2.savepoint = savepoint;
      sql2.prepare = (x) => prepare = x.replace(/[^a-z0-9$-_. ]/gi);
      let uncaughtError, result;
      name && await sql2`savepoint ${sql2(name)}`;
      try {
        result = await new Promise((resolve, reject) => {
          const x = fn2(sql2);
          Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject);
        });
        if (uncaughtError)
          throw uncaughtError;
      } catch (e) {
        await (name ? sql2`rollback to ${sql2(name)}` : sql2`rollback`);
        throw e instanceof PostgresError && e.code === "25P02" && uncaughtError || e;
      }
      if (!name) {
        prepare ? await sql2`prepare transaction '${sql2.unsafe(prepare)}'` : await sql2`commit`;
      }
      return result;
      function savepoint(name2, fn3) {
        if (name2 && Array.isArray(name2.raw))
          return savepoint((sql3) => sql3.apply(sql3, arguments));
        arguments.length === 1 && (fn3 = name2, name2 = null);
        return scope(c, fn3, "s" + savepoints++ + (name2 ? "_" + name2 : ""));
      }
      function handler2(q) {
        q.catch((e) => uncaughtError || (uncaughtError = e));
        c.queue === full ? queries3.push(q) : c.execute(q) || move(c, full);
      }
    }
    function onexecute(c) {
      connection2 = c;
      move(c, reserved);
      c.reserved = () => queries3.length ? c.execute(queries3.shift()) : move(c, reserved);
    }
  }
  function move(c, queue) {
    c.queue.remove(c);
    queue.push(c);
    c.queue = queue;
    queue === open ? c.idleTimer.start() : c.idleTimer.cancel();
    return c;
  }
  function json(x) {
    return new Parameter(x, 3802);
  }
  function array(x, type) {
    if (!Array.isArray(x))
      return array(Array.from(arguments));
    return new Parameter(x, type || (x.length ? inferType(x) || 25 : 0), options.shared.typeArrayMap);
  }
  function handler(query) {
    if (ending)
      return query.reject(Errors.connection("CONNECTION_ENDED", options, options));
    if (open.length)
      return go(open.shift(), query);
    if (closed.length)
      return connect(closed.shift(), query);
    busy.length ? go(busy.shift(), query) : queries2.push(query);
  }
  function go(c, query) {
    return c.execute(query) ? move(c, busy) : move(c, full);
  }
  function cancel(query) {
    return new Promise((resolve, reject) => {
      query.state ? query.active ? connection_default(options).cancel(query.state, resolve, reject) : query.cancelled = { resolve, reject } : (queries2.remove(query), query.cancelled = true, query.reject(Errors.generic("57014", "canceling statement due to user request")), resolve());
    });
  }
  async function end({ timeout = null } = {}) {
    if (ending)
      return ending;
    await 1;
    let timer2;
    return ending = Promise.race([
      new Promise((r) => timeout !== null && (timer2 = setTimeout(destroy, timeout * 1e3, r))),
      Promise.all(connections.map((c) => c.end()).concat(
        listen.sql ? listen.sql.end({ timeout: 0 }) : [],
        subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : []
      ))
    ]).then(() => clearTimeout(timer2));
  }
  async function close() {
    await Promise.all(connections.map((c) => c.end()));
  }
  async function destroy(resolve) {
    await Promise.all(connections.map((c) => c.terminate()));
    while (queries2.length)
      queries2.shift().reject(Errors.connection("CONNECTION_DESTROYED", options));
    resolve();
  }
  function connect(c, query) {
    move(c, connecting);
    c.connect(query);
    return c;
  }
  function onend(c) {
    move(c, ended);
  }
  function onopen(c) {
    if (queries2.length === 0)
      return move(c, open);
    let max = Math.ceil(queries2.length / (connecting.length + 1)), ready = true;
    while (ready && queries2.length && max-- > 0) {
      const query = queries2.shift();
      if (query.reserve)
        return query.reserve(c);
      ready = c.execute(query);
    }
    ready ? move(c, busy) : move(c, full);
  }
  function onclose(c, e) {
    move(c, closed);
    c.reserved = null;
    c.onclose && (c.onclose(e), c.onclose = null);
    options.onclose && options.onclose(c.id);
    queries2.length && connect(c, queries2.shift());
  }
}
function parseOptions(a, b2) {
  if (a && a.shared)
    return a;
  const env = process.env, o = (!a || typeof a === "string" ? b2 : a) || {}, { url, multihost } = parseUrl(a), query = [...url.searchParams].reduce((a2, [b3, c]) => (a2[b3] = c, a2), {}), host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || "localhost", port = o.port || url.port || env.PGPORT || 5432, user = o.user || o.username || url.username || env.PGUSERNAME || env.PGUSER || osUsername();
  o.no_prepare && (o.prepare = false);
  query.sslmode && (query.ssl = query.sslmode, delete query.sslmode);
  "timeout" in o && (console.log("The timeout option is deprecated, use idle_timeout instead"), o.idle_timeout = o.timeout);
  query.sslrootcert === "system" && (query.ssl = "verify-full");
  const ints = ["idle_timeout", "connect_timeout", "max_lifetime", "max_pipeline", "backoff", "keep_alive"];
  const defaults = {
    max: globalThis.Cloudflare ? 3 : 10,
    ssl: false,
    sslnegotiation: null,
    idle_timeout: null,
    connect_timeout: 30,
    max_lifetime,
    max_pipeline: 100,
    backoff,
    keep_alive: 60,
    prepare: true,
    debug: false,
    fetch_types: true,
    publications: "alltables",
    target_session_attrs: null
  };
  return {
    host: Array.isArray(host) ? host : host.split(",").map((x) => x.split(":")[0]),
    port: Array.isArray(port) ? port : host.split(",").map((x) => parseInt(x.split(":")[1] || port)),
    path: o.path || host.indexOf("/") > -1 && host + "/.s.PGSQL." + port,
    database: o.database || o.db || (url.pathname || "").slice(1) || env.PGDATABASE || user,
    user,
    pass: o.pass || o.password || url.password || env.PGPASSWORD || "",
    ...Object.entries(defaults).reduce(
      (acc, [k, d]) => {
        const value = k in o ? o[k] : k in query ? query[k] === "disable" || query[k] === "false" ? false : query[k] : env["PG" + k.toUpperCase()] || d;
        acc[k] = typeof value === "string" && ints.includes(k) ? +value : value;
        return acc;
      },
      {}
    ),
    connection: {
      application_name: env.PGAPPNAME || "postgres.js",
      ...o.connection,
      ...Object.entries(query).reduce((acc, [k, v]) => (k in defaults || (acc[k] = v), acc), {})
    },
    types: o.types || {},
    target_session_attrs: tsa(o, url, env),
    onnotice: o.onnotice,
    onnotify: o.onnotify,
    onclose: o.onclose,
    onparameter: o.onparameter,
    socket: o.socket,
    transform: parseTransform(o.transform || { undefined: void 0 }),
    parameters: {},
    shared: { retries: 0, typeArrayMap: {} },
    ...mergeUserTypes(o.types)
  };
}
function tsa(o, url, env) {
  const x = o.target_session_attrs || url.searchParams.get("target_session_attrs") || env.PGTARGETSESSIONATTRS;
  if (!x || ["read-write", "read-only", "primary", "standby", "prefer-standby"].includes(x))
    return x;
  throw new Error("target_session_attrs " + x + " is not supported");
}
function backoff(retries) {
  return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20);
}
function max_lifetime() {
  return 60 * (30 + Math.random() * 30);
}
function parseTransform(x) {
  return {
    undefined: x.undefined,
    column: {
      from: typeof x.column === "function" ? x.column : x.column && x.column.from,
      to: x.column && x.column.to
    },
    value: {
      from: typeof x.value === "function" ? x.value : x.value && x.value.from,
      to: x.value && x.value.to
    },
    row: {
      from: typeof x.row === "function" ? x.row : x.row && x.row.from,
      to: x.row && x.row.to
    }
  };
}
function parseUrl(url) {
  if (!url || typeof url !== "string")
    return { url: { searchParams: /* @__PURE__ */ new Map() } };
  let host = url;
  host = host.slice(host.indexOf("://") + 3).split(/[?/]/)[0];
  host = decodeURIComponent(host.slice(host.indexOf("@") + 1));
  const urlObj = new URL(url.replace(host, host.split(",")[0]));
  return {
    url: {
      username: decodeURIComponent(urlObj.username),
      password: decodeURIComponent(urlObj.password),
      host: urlObj.host,
      hostname: urlObj.hostname,
      port: urlObj.port,
      pathname: urlObj.pathname,
      searchParams: urlObj.searchParams
    },
    multihost: host.indexOf(",") > -1 && host
  };
}
function osUsername() {
  try {
    return os.userInfo().username;
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME;
  }
}

// site-backend/db.js
function openDatabase(env, schema = "fleetflow") {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid schema");
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) throw new Error("Database configuration missing");
  return src_default({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSLMODE === "require" ? "require" : false,
    max: 1,
    connect_timeout: 8,
    idle_timeout: 1,
    max_lifetime: 60,
    prepare: false,
    connection: { search_path: schema, TimeZone: "Asia/Taipei", statement_timeout: "12000", application_name: "FleetFlow GPT Site" },
    types: { safeInteger: { to: 20, from: [20], serialize: String, parse: (value) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error("ID outside safe range");
      return number;
    } }, calendarDate: { to: 1082, from: [1082], serialize: String, parse: (value) => value } },
    onnotice: () => {
    }
  });
}

// site-backend/validation.js
var ApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var MODEL = "Rolls-Royce Cullinan 6.75 V12";
var fail = (message) => {
  throw new ApiError(422, message);
};
var required = (body, key) => {
  if (body[key] === void 0) fail(`\u8ACB\u586B\u5BEB ${key}`);
  return body[key];
};
function text(value, key, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${key} \u4E0D\u53EF\u7A7A\u767D\u6216\u8D85\u904E ${max} \u5B57\u5143`);
  return value.trim();
}
function id(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail("\u7DE8\u865F\u5FC5\u9808\u70BA\u6B63\u6574\u6578");
  return value;
}
function choice(value, key, options) {
  if (!options.includes(value)) fail(`${key} \u4E0D\u5728\u5141\u8A31\u7BC4\u570D`);
  return value;
}
function day(value, key) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || (/* @__PURE__ */ new Date(value + "T00:00:00Z")).toISOString().slice(0, 10) !== value) fail(`${key} \u65E5\u671F\u683C\u5F0F\u932F\u8AA4`);
  return value;
}
function timestamp(value, key) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) fail(`${key} \u5FC5\u9808\u5305\u542B\u6709\u6548\u6642\u9593\u53CA\u6642\u5340`);
  day(value.slice(0, 10), key);
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19) || 0) > 59) fail(`${key} \u6642\u9593\u683C\u5F0F\u932F\u8AA4`);
  return value;
}
function decimal(value, key, digits, scale, positive = false) {
  if (!["string", "number"].includes(typeof value)) fail(`${key} \u5FC5\u9808\u70BA\u6578\u5B57`);
  const valueString = String(value);
  const pattern = new RegExp(`^\\d{1,${digits - scale}}(?:\\.\\d{1,${scale}})?$`);
  if (!pattern.test(valueString) || !Number.isFinite(Number(valueString)) || positive && Number(valueString) <= 0) fail(`${key} \u6578\u503C\u6216\u7CBE\u5EA6\u932F\u8AA4`);
  return valueString;
}
var fields = {
  departments: ["department_name"],
  employees: ["employee_name", "department_id", "phone_numbers", "password"],
  vehicles: ["license_plate", "vehicle_model", "vehicle_status"],
  applications: ["employee_id", "purpose", "requested_start_date", "requested_end_date"],
  dispatches: ["application_id", "vehicle_id", "actual_start_date", "actual_end_date"],
  maintenance: ["vehicle_id", "maintenance_date", "maintenance_item", "maintenance_cost"],
  refueling: ["vehicle_id", "refueling_date", "fuel_liters", "fuel_cost"],
  review: ["approval_status"]
};
fields["employee-applications"] = [...fields.applications, "vehicle_id"];
fields.availability = ["requested_start_date", "requested_end_date"];
function validate(resource, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("\u8ACB\u6C42\u5FC5\u9808\u70BA JSON \u7269\u4EF6");
  if (!fields[resource] || Object.keys(body).some((key) => !fields[resource].includes(key))) fail("\u5305\u542B\u672A\u77E5\u6B04\u4F4D");
  const get = (key) => required(body, key);
  let result;
  switch (resource) {
    case "departments":
      return { department_name: text(get("department_name"), "department_name", 80) };
    case "employees": {
      const phones = body.phone_numbers ?? [];
      if (!Array.isArray(phones) || phones.length > 10) fail("\u806F\u7D61\u96FB\u8A71\u6700\u591A\u5341\u7B46");
      result = {
        employee_name: text(get("employee_name"), "employee_name", 80),
        department_id: id(get("department_id")),
        phone_numbers: [...new Set(phones.map((phone) => text(phone, "phone_numbers", 30)))].sort()
      };
      if (body.password !== void 0) {
        if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) fail("\u5BC6\u78BC\u9700 8 \u81F3 128 \u5B57\u5143");
        result.password = body.password;
      }
      break;
    }
    case "vehicles":
      return {
        license_plate: text(get("license_plate"), "license_plate", 20).toUpperCase(),
        vehicle_model: choice(body.vehicle_model ?? MODEL, "vehicle_model", [MODEL]),
        vehicle_status: choice(body.vehicle_status ?? "available", "vehicle_status", ["available", "maintenance", "retired"])
      };
    case "employee-applications":
    case "applications":
      result = {
        employee_id: id(get("employee_id")),
        purpose: text(get("purpose"), "purpose", 500),
        requested_start_date: timestamp(get("requested_start_date"), "requested_start_date"),
        requested_end_date: timestamp(get("requested_end_date"), "requested_end_date")
      };
      break;
    case "availability":
      result = { requested_start_date: timestamp(get("requested_start_date"), "requested_start_date"), requested_end_date: timestamp(get("requested_end_date"), "requested_end_date") };
      break;
    case "dispatches":
      result = {
        application_id: id(get("application_id")),
        vehicle_id: id(get("vehicle_id")),
        actual_start_date: timestamp(get("actual_start_date"), "actual_start_date"),
        actual_end_date: timestamp(get("actual_end_date"), "actual_end_date")
      };
      break;
    case "maintenance":
      return {
        vehicle_id: id(get("vehicle_id")),
        maintenance_date: day(get("maintenance_date"), "maintenance_date"),
        maintenance_item: text(get("maintenance_item"), "maintenance_item", 250),
        maintenance_cost: decimal(get("maintenance_cost"), "maintenance_cost", 12, 2)
      };
    case "refueling":
      return {
        vehicle_id: id(get("vehicle_id")),
        refueling_date: day(get("refueling_date"), "refueling_date"),
        fuel_liters: decimal(get("fuel_liters"), "fuel_liters", 9, 3, true),
        fuel_cost: decimal(get("fuel_cost"), "fuel_cost", 12, 2)
      };
    case "review":
      return { approval_status: choice(get("approval_status"), "approval_status", ["approved", "rejected"]) };
  }
  if (resource === "employee-applications" && body.vehicle_id !== void 0 && body.vehicle_id !== null) result.vehicle_id = id(body.vehicle_id);
  if (["applications", "employee-applications", "availability", "dispatches"].includes(resource)) {
    const start = resource !== "dispatches" ? result.requested_start_date : result.actual_start_date;
    const end = resource !== "dispatches" ? result.requested_end_date : result.actual_end_date;
    if (Date.parse(end) <= Date.parse(start)) fail("\u8FC4\u65E5\u5FC5\u9808\u665A\u65BC\u8D77\u65E5");
  }
  return result;
}
async function readBody(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 32768) throw new ApiError(413, "\u8ACB\u6C42\u8CC7\u6599\u904E\u5927");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(422, "JSON \u683C\u5F0F\u932F\u8AA4");
  }
}

// site-backend/queries.js
var queries = {
  "employees": [
    "SELECT e.employee_id,e.employee_code,e.employee_name,e.department_id,d.department_name,\n            COALESCE((SELECT array_agg(p.phone_number ORDER BY p.phone_number) FROM employee_phones p\n                      WHERE p.employee_id=e.employee_id), ARRAY[]::varchar[]) AS phone_numbers\n            FROM employees e JOIN departments d USING(department_id)\n            ORDER BY e.employee_id"
  ],
  "vehicles": [
    "SELECT v.*, EXISTS(SELECT 1 FROM dispatches d WHERE d.vehicle_id=v.vehicle_id\n            AND d.returned_at IS NULL AND now() >= d.actual_start_date AND now() < d.actual_end_date) AS in_use\n            FROM vehicles v ORDER BY vehicle_id"
  ],
  "applications_base": "SELECT a.*,e.employee_name,d.department_name,ds.dispatch_id,ds.vehicle_id,v.license_plate,\n    ds.returned_at,ds.actual_start_date AS dispatch_start_date,ds.actual_end_date AS dispatch_end_date FROM applications a JOIN employees e USING(employee_id)\n    JOIN departments d ON d.department_id=e.department_id\n    LEFT JOIN dispatches ds USING(application_id) LEFT JOIN vehicles v ON v.vehicle_id=ds.vehicle_id",
  "dispatches_base": "SELECT ds.*,v.license_plate,v.vehicle_model,a.purpose,e.employee_name,a.employee_id\n    FROM dispatches ds JOIN vehicles v USING(vehicle_id) JOIN applications a USING(application_id)\n    JOIN employees e USING(employee_id)",
  "maintenance": [
    "SELECT m.*,v.license_plate FROM maintenance_records m JOIN vehicles v USING(vehicle_id) ORDER BY maintenance_date DESC, m.vehicle_id"
  ],
  "refueling": [
    "SELECT r.*,v.license_plate FROM refueling_records r JOIN vehicles v USING(vehicle_id) ORDER BY refueling_date DESC,r.vehicle_id"
  ],
  "dashboard": [
    "SELECT count(*) AS n FROM vehicles WHERE vehicle_status<>'retired'",
    "SELECT count(*) FILTER(WHERE approval_status='pending') AS pending,\n            count(*) FILTER(WHERE approval_status='approved') AS approved FROM applications",
    "SELECT count(*) AS n FROM dispatches ds JOIN applications a USING(application_id)\n            WHERE ds.returned_at IS NULL",
    "SELECT\n            COALESCE((SELECT sum(maintenance_cost) FROM maintenance_records WHERE date_trunc('month',maintenance_date)=date_trunc('month',CURRENT_DATE)),0)\n            + COALESCE((SELECT sum(fuel_cost) FROM refueling_records WHERE date_trunc('month',refueling_date)=date_trunc('month',CURRENT_DATE)),0) AS cost"
  ],
  "statistics": [
    "SELECT approval_status,count(*) AS count FROM applications GROUP BY approval_status ORDER BY approval_status",
    "SELECT d.department_name,count(a.application_id) AS applications,\n            count(ds.dispatch_id) AS dispatches FROM departments d\n            LEFT JOIN employees e USING(department_id) LEFT JOIN applications a USING(employee_id)\n            LEFT JOIN dispatches ds USING(application_id) GROUP BY d.department_id,d.department_name\n            ORDER BY applications DESC,d.department_name",
    "WITH months AS (\n            SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',\n                                   date_trunc('month',CURRENT_DATE),interval '1 month')::date AS month\n        ), maintenance AS (\n            SELECT date_trunc('month',maintenance_date)::date AS month,sum(maintenance_cost) AS cost\n            FROM maintenance_records GROUP BY 1\n        ), fuel AS (\n            SELECT date_trunc('month',refueling_date)::date AS month,sum(fuel_cost) AS cost\n            FROM refueling_records GROUP BY 1\n        ) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE(a.cost,0) AS maintenance_cost,\n            COALESCE(f.cost,0) AS fuel_cost,COALESCE(a.cost,0)+COALESCE(f.cost,0) AS total\n            FROM months m LEFT JOIN maintenance a USING(month) LEFT JOIN fuel f USING(month) ORDER BY m.month",
    "SELECT (SELECT count(*) FROM applications) AS applications,\n            (SELECT count(*) FROM dispatches) AS dispatches,\n            (SELECT count(*) FROM dispatches WHERE returned_at IS NOT NULL) AS returned,\n            (SELECT COALESCE(sum(maintenance_cost),0) FROM maintenance_records)\n            + (SELECT COALESCE(sum(fuel_cost),0) FROM refueling_records) AS lifetime_cost"
  ]
};

// site-backend/availability.js
var teamBookingsSQL = `SELECT ds.dispatch_id,ds.application_id,ds.vehicle_id,v.license_plate,e.employee_name,
  a.purpose,ds.actual_start_date,ds.actual_end_date,ds.returned_at
  FROM dispatches ds JOIN applications a USING(application_id) JOIN employees e USING(employee_id) JOIN vehicles v USING(vehicle_id)
  WHERE ds.returned_at IS NULL AND ds.actual_end_date>now() ORDER BY ds.actual_start_date,ds.vehicle_id`;
async function availability(sql, start, end, except = 0) {
  const vehicles = await sql.unsafe(`SELECT v.vehicle_id,v.license_plate,v.vehicle_model,v.vehicle_status,
    (v.vehicle_status='available' AND NOT EXISTS(SELECT 1 FROM dispatches ds WHERE ds.vehicle_id=v.vehicle_id
     AND ds.application_id<>$3 AND ds.actual_start_date<$2 AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$1)) AS available_in_period
    FROM vehicles v WHERE vehicle_status<>'retired' ORDER BY vehicle_id`, [start, end, except]);
  const bookings = await sql.unsafe(`SELECT ds.dispatch_id,ds.vehicle_id,v.license_plate,e.employee_name,a.purpose,ds.actual_start_date,ds.actual_end_date
    FROM dispatches ds JOIN applications a USING(application_id) JOIN employees e USING(employee_id) JOIN vehicles v USING(vehicle_id)
    WHERE ds.application_id<>$3 AND ds.actual_start_date<$2 AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$1 ORDER BY ds.actual_start_date,ds.vehicle_id`, [start, end, except]);
  return { vehicles, bookings };
}

// site-backend/employee-api.js
var execute = (sql, query, values2 = []) => sql.unsafe(query, values2);
async function find(sql, table, key, value, lock = false) {
  const row = (await execute(sql, `SELECT * FROM ${table} WHERE ${key}=$1${lock ? " FOR UPDATE" : ""}`, [value]))[0];
  if (!row) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A\u8CC7\u6599\u3002");
  return row;
}
var applications = (sql, employee) => execute(sql, queries.applications_base + " WHERE a.employee_id=$1 ORDER BY a.created_at DESC", [employee]);
var dispatches = (sql, employee) => execute(sql, queries.dispatches_base + " WHERE a.employee_id=$1 ORDER BY ds.actual_start_date DESC", [employee]);
var conflictSQL = `SELECT 1 FROM dispatches ds JOIN applications a USING(application_id)
  WHERE %CONDITION% AND ds.application_id<>$4 AND ds.actual_start_date<$2
  AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$3`;
async function selectVehicle(sql, employee, start, end, except = 0, preferred = null) {
  if (Date.parse(start) <= Date.now()) throw new ApiError(409, "\u9810\u8A08\u8D77\u65E5\u9808\u665A\u65BC\u76EE\u524D\u6642\u9593\uFF0C\u8ACB\u9078\u64C7\u672A\u4F86\u7684\u7528\u8ECA\u6642\u6BB5\u3002");
  const employeeConflict = await execute(sql, conflictSQL.replace("%CONDITION%", "a.employee_id=$1"), [employee, end, start, except]);
  if (employeeConflict.length) throw new ApiError(409, "\u4F60\u5728\u6B64\u6642\u6BB5\u5DF2\u6709\u884C\u7A0B\uFF0C\u8ACB\u9078\u64C7\u5176\u4ED6\u6642\u9593\u3002");
  const candidates = await execute(sql, "SELECT vehicle_id FROM vehicles WHERE vehicle_status='available' AND ($1::bigint IS NULL OR vehicle_id=$1) ORDER BY vehicle_id", [preferred]);
  for (const candidate of candidates) {
    const vehicle = await find(sql, "vehicles", "vehicle_id", candidate.vehicle_id, true);
    if (vehicle.vehicle_status !== "available") continue;
    const overlap = await execute(sql, conflictSQL.replace("%CONDITION%", "ds.vehicle_id=$1"), [vehicle.vehicle_id, end, start, except]);
    if (!overlap.length) return vehicle;
  }
  throw new ApiError(409, preferred ? "\u9019\u53F0\u8ECA\u5728\u6240\u9078\u6642\u6BB5\u7121\u6CD5\u501F\u7528\uFF0C\u8ACB\u63DB\u8ECA\u6216\u8ABF\u6574\u6642\u9593\u3002" : "\u6240\u9078\u6642\u6BB5\u6C92\u6709\u53EF\u7528\u8ECA\u8F1B\uFF0C\u8ACB\u8ABF\u6574\u7528\u8ECA\u6642\u9593\u5F8C\u518D\u9001\u51FA\u3002");
}
async function ownApplication(sql, employee, application) {
  await find(sql, "employees", "employee_id", employee, true);
  const row = await find(sql, "applications", "application_id", application, true);
  if (row.employee_id !== employee) throw new ApiError(403, "\u53EA\u80FD\u64CD\u4F5C\u76EE\u524D\u54E1\u5DE5\u81EA\u5DF1\u7684\u7533\u8ACB\u3002");
  const trip = (await execute(sql, "SELECT * FROM dispatches WHERE application_id=$1 FOR UPDATE", [application]))[0];
  if (trip && (trip.returned_at || new Date(trip.actual_start_date).getTime() <= Date.now())) throw new ApiError(409, "\u884C\u7A0B\u5DF2\u958B\u59CB\u6216\u5DF2\u6B78\u9084\uFF0C\u7121\u6CD5\u4FEE\u6539\u3001\u53D6\u6D88\u6216\u522A\u55AE\u3002");
  return { row, trip };
}
async function saveApplication(sql, employee, body, application = null) {
  let old;
  if (application) {
    old = await ownApplication(sql, employee, application);
    if (!["pending", "approved"].includes(old.row.approval_status)) throw new ApiError(409, "\u5DF2\u53D6\u6D88\u6216\u5DF2\u99C1\u56DE\u7684\u7533\u8ACB\u7121\u6CD5\u4FEE\u6539\uFF0C\u8ACB\u91CD\u65B0\u7533\u8ACB\u3002");
  } else await find(sql, "employees", "employee_id", employee, true);
  const vehicle = await selectVehicle(sql, employee, body.requested_start_date, body.requested_end_date, application || 0, body.vehicle_id);
  const row = application ? (await execute(sql, `UPDATE applications SET purpose=$1,requested_start_date=$2,requested_end_date=$3,approval_status='approved'
      WHERE application_id=$4 RETURNING *`, [body.purpose, body.requested_start_date, body.requested_end_date, application]))[0] : (await execute(sql, `INSERT INTO applications(employee_id,purpose,requested_start_date,requested_end_date,approval_status)
      VALUES($1,$2,$3,$4,'approved') RETURNING *`, [employee, body.purpose, body.requested_start_date, body.requested_end_date]))[0];
  const trip = old?.trip ? (await execute(
    sql,
    `UPDATE dispatches SET vehicle_id=$1,actual_start_date=$2,actual_end_date=$3 WHERE dispatch_id=$4 RETURNING *`,
    [vehicle.vehicle_id, body.requested_start_date, body.requested_end_date, old.trip.dispatch_id]
  ))[0] : (await execute(
    sql,
    `INSERT INTO dispatches(application_id,vehicle_id,actual_start_date,actual_end_date) VALUES($1,$2,$3,$4) RETURNING *`,
    [row.application_id, vehicle.vehicle_id, body.requested_start_date, body.requested_end_date]
  ))[0];
  return { ...row, dispatch_id: trip.dispatch_id, license_plate: vehicle.license_plate, auto_approved: true };
}
async function context(sql, employee) {
  const profile = (await execute(sql, queries.employees[0].replace("ORDER BY e.employee_id", "WHERE e.employee_id=$1"), [employee]))[0];
  if (!profile) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A\u54E1\u5DE5\u3002");
  const apps = await applications(sql, employee), trips = await dispatches(sql, employee), vehicles = await execute(sql, queries.vehicles[0]);
  const maintenance = await execute(sql, queries.maintenance[0]), refueling = await execute(sql, queries.refueling[0]);
  const team_bookings = await execute(sql, teamBookingsSQL);
  const months = await execute(sql, `WITH months AS (
    SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',date_trunc('month',CURRENT_DATE),interval '1 month')::date AS month
  ) SELECT to_char(m.month,'YYYY-MM') AS month,
    (SELECT count(*) FROM applications a WHERE a.employee_id=$1 AND date_trunc('month',a.requested_start_date AT TIME ZONE 'Asia/Taipei')::date=m.month) AS applications,
    (SELECT count(*) FROM dispatches ds JOIN applications a USING(application_id) WHERE a.employee_id=$1 AND date_trunc('month',ds.actual_start_date AT TIME ZONE 'Asia/Taipei')::date=m.month) AS dispatches
    FROM months m ORDER BY m.month`, [employee]);
  const approval_status = ["pending", "approved", "rejected", "cancelled"].map((status) => ({ approval_status: status, count: apps.filter((a) => a.approval_status === status).length }));
  const totals = {
    applications: apps.length,
    dispatches: trips.length,
    returned: trips.filter((t) => t.returned_at).length,
    scheduled_hours: Math.round(trips.reduce((sum, t) => sum + (new Date(t.actual_end_date) - new Date(t.actual_start_date)) / 36e5, 0) * 10) / 10
  };
  return { employee: profile, applications: apps, dispatches: trips, maintenance, refueling, team_bookings, vehicles: vehicles.filter((v) => v.vehicle_status !== "retired"), statistics: { totals, approval_status, months } };
}
async function handleEmployeeApi(request, env, databaseFactory, employee) {
  const url = new URL(request.url), parts = url.pathname.split("/").filter(Boolean), resource = parts[1], action = parts[3], method = request.method;
  if (parts.length > 4) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A API\u3002");
  if (action === "review" || resource === "my-dispatches" && method === "POST" && !action) throw new ApiError(403, "\u54E1\u5DE5\u4E0D\u9700\u8981\u624B\u52D5\u5BE9\u6838\u6216\u6D3E\u8ECA\u3002");
  if (!employee) throw new ApiError(401, "\u8ACB\u5148\u767B\u5165\u3002");
  const value = parts[2] === void 0 ? null : id(Number(parts[2]));
  let body;
  if (resource === "my-applications" && ["POST", "PUT"].includes(method) && !action) {
    body = validate("employee-applications", await readBody(request));
    if (body.employee_id !== employee) throw new ApiError(403, "\u7533\u8ACB\u54E1\u5DE5\u8207\u76EE\u524D\u54E1\u5DE5\u4E0D\u4E00\u81F4\u3002");
  }
  const sql = databaseFactory(env);
  try {
    let result, status = 200;
    if (resource === "availability" && method === "GET" && value === null && !action) {
      const period = validate("availability", { requested_start_date: url.searchParams.get("start"), requested_end_date: url.searchParams.get("end") });
      const except = url.searchParams.has("exclude") ? id(Number(url.searchParams.get("exclude"))) : 0;
      result = await sql.begin("isolation level repeatable read read only", async (transaction) => {
        if (except) {
          const own = await find(transaction, "applications", "application_id", except);
          if (own.employee_id !== employee) throw new ApiError(403, "\u7121\u6CD5\u6392\u9664\u5176\u4ED6\u54E1\u5DE5\u7684\u9810\u7D04\u3002");
        }
        return availability(transaction, period.requested_start_date, period.requested_end_date, except);
      });
    } else if (resource === "employee-context" && method === "GET" && value === null && !action) result = await sql.begin("isolation level repeatable read read only", (transaction) => context(transaction, employee));
    else if (resource === "my-applications" && method === "GET" && value === null && !action) {
      await find(sql, "employees", "employee_id", employee);
      result = await applications(sql, employee);
    } else if (resource === "my-dispatches" && method === "GET" && value === null && !action) {
      await find(sql, "employees", "employee_id", employee);
      result = await dispatches(sql, employee);
    } else if (resource === "my-applications" && (method === "POST" && value === null || method === "PUT" && value !== null) && !action) {
      status = method === "POST" ? 201 : 200;
      result = await sql.begin((transaction) => saveApplication(transaction, employee, body, value));
    } else if (resource === "my-applications" && value !== null && (method === "DELETE" && !action || method === "POST" && action === "cancel")) {
      result = await sql.begin(async (transaction) => {
        const { row, trip } = await ownApplication(transaction, employee, value);
        if (action === "cancel" && !["pending", "approved"].includes(row.approval_status)) throw new ApiError(409, "\u6B64\u7533\u8ACB\u5DF2\u53D6\u6D88\u6216\u5DF2\u7D50\u6848\u3002");
        if (trip) await execute(transaction, "DELETE FROM dispatches WHERE dispatch_id=$1", [trip.dispatch_id]);
        if (method === "DELETE") {
          await execute(transaction, "DELETE FROM applications WHERE application_id=$1", [value]);
          return { deleted: true, application_id: value };
        }
        return (await execute(transaction, "UPDATE applications SET approval_status='cancelled' WHERE application_id=$1 RETURNING *", [value]))[0];
      });
    } else if (resource === "my-dispatches" && value !== null && method === "POST" && action === "return") {
      result = await sql.begin(async (transaction) => {
        await find(transaction, "employees", "employee_id", employee, true);
        const owner = (await execute(transaction, "SELECT employee_id FROM applications a JOIN dispatches ds USING(application_id) WHERE ds.dispatch_id=$1", [value]))[0];
        if (!owner) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A\u884C\u7A0B\u3002");
        if (owner.employee_id !== employee) throw new ApiError(403, "\u53EA\u80FD\u6B78\u9084\u76EE\u524D\u54E1\u5DE5\u81EA\u5DF1\u7684\u8ECA\u8F1B\u3002");
        const trip = await find(transaction, "dispatches", "dispatch_id", value, true);
        if (trip.returned_at) throw new ApiError(409, "\u6B64\u884C\u7A0B\u5DF2\u5B8C\u6210\u6B78\u9084\u3002");
        if (new Date(trip.actual_start_date).getTime() > Date.now()) throw new ApiError(409, "\u884C\u7A0B\u5C1A\u672A\u958B\u59CB\uFF0C\u4E0D\u80FD\u767B\u8A18\u6B78\u9084\u3002");
        return (await execute(transaction, "UPDATE dispatches SET returned_at=now() WHERE dispatch_id=$1 RETURNING *", [value]))[0];
      });
    } else throw new ApiError(405, "\u4E0D\u652F\u63F4\u7684\u64CD\u4F5C\u3002");
    return Response.json(result, { status });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {
    });
  }
}

// site-backend/auth.js
var encoder = new TextEncoder();
var COOKIE = "fleetflow_session";
var hex = (bytes) => Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
var random = (length) => hex(crypto.getRandomValues(new Uint8Array(length)));
var digest = async (value) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
async function verifyPassword(password, stored) {
  const actual = encoder.encode(password), expected = encoder.encode(stored || "");
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) difference |= (actual[i] || 0) ^ (expected[i] || 0);
  return typeof stored === "string" && stored.length > 0 && difference === 0;
}
function cookie(request, token = "", maxAge = 28800) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
function tokenFrom(request) {
  const match = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)fleetflow_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1];
}
async function requireSession(request, sql) {
  const token = tokenFrom(request);
  if (!token) throw new ApiError(401, "\u8ACB\u5148\u767B\u5165\u3002");
  const session = (await sql.unsafe("SELECT s.employee_id,s.csrf_token,s.session_hash FROM auth_sessions s JOIN employees e USING(employee_id) WHERE s.session_hash=$1 AND s.expires_at>now() AND e.password IS NOT NULL", [await digest(token)]))[0];
  if (!session) throw new ApiError(401, "\u767B\u5165\u5DF2\u5931\u6548\uFF0C\u8ACB\u91CD\u65B0\u767B\u5165\u3002");
  const requested = new URL(request.url).searchParams.get("employee_id");
  if (requested !== null && Number(requested) !== session.employee_id) throw new ApiError(403, "\u7121\u6CD5\u5B58\u53D6\u5176\u4ED6\u54E1\u5DE5\u8CC7\u6599\u3002");
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("X-CSRF-Token") !== session.csrf_token) throw new ApiError(403, "\u64CD\u4F5C\u9A57\u8B49\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u767B\u5165\u3002");
  return session;
}
async function handleAuth(request, sql) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path === "/api/auth/login" && method === "POST") {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["employee_code", "password"].includes(k)) || typeof body.employee_code !== "string" || !/^EMP[0-9]{4,19}$/.test(body.employee_code) || typeof body.password !== "string" || body.password.length < 1 || body.password.length > 128) throw new ApiError(422, "\u8ACB\u586B\u5BEB\u5DE5\u865F\uFF08\u4F8B\u5982 EMP0001\uFF09\u8207\u5BC6\u78BC\u3002");
    const code = body.employee_code, ip = await digest(request.headers.get("CF-Connecting-IP") || "local");
    const outcome = await sql.begin(async (tx) => {
      const buckets = [`account:${code}`, `ip:${ip}`], limits = [];
      for (const key of buckets) {
        await tx.unsafe("INSERT INTO auth_login_limits(bucket) VALUES($1) ON CONFLICT DO NOTHING", [key]);
        let row = (await tx.unsafe("SELECT * FROM auth_login_limits WHERE bucket=$1 FOR UPDATE", [key]))[0];
        if (new Date(row.window_start).getTime() < Date.now() - 9e5) row = (await tx.unsafe("UPDATE auth_login_limits SET attempts=0,window_start=now() WHERE bucket=$1 RETURNING *", [key]))[0];
        limits.push(row);
      }
      if (limits.some((r, i) => r.attempts >= (i === 0 ? 5 : 30))) return { status: 429 };
      const person = (await tx.unsafe("SELECT employee_id,employee_code,employee_name,password FROM employees WHERE employee_code=$1 FOR UPDATE", [code]))[0];
      if (!await verifyPassword(body.password, person?.password)) {
        await tx.unsafe("UPDATE auth_login_limits SET attempts=attempts+1 WHERE bucket=ANY($1::text[])", [buckets]);
        return { status: 401 };
      }
      await tx.unsafe("DELETE FROM auth_login_limits WHERE bucket=$1", [buckets[0]]);
      await tx.unsafe("DELETE FROM auth_sessions WHERE expires_at<=now()");
      const token = random(32), csrf = random(32);
      await tx.unsafe("INSERT INTO auth_sessions(session_hash,employee_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", [await digest(token), person.employee_id, csrf]);
      return { token, csrf_token: csrf, employee: { employee_id: person.employee_id, employee_code: person.employee_code, employee_name: person.employee_name } };
    });
    if (outcome.status) return Response.json({ detail: outcome.status === 429 ? "\u767B\u5165\u5617\u8A66\u904E\u591A\uFF0C\u8ACB 15 \u5206\u9418\u5F8C\u518D\u8A66\u3002" : "\u5DE5\u865F\u6216\u5BC6\u78BC\u932F\u8AA4\u3002" }, { status: outcome.status });
    return Response.json({ employee: outcome.employee, csrf_token: outcome.csrf_token }, { headers: { "Set-Cookie": cookie(request, outcome.token) } });
  }
  if (path === "/api/auth/session" && method === "GET") {
    const session = await requireSession(request, sql), person = (await sql.unsafe("SELECT employee_id,employee_code,employee_name FROM employees WHERE employee_id=$1", [session.employee_id]))[0];
    return Response.json({ employee: person, csrf_token: session.csrf_token });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    const session = await requireSession(request, sql);
    await sql.unsafe("DELETE FROM auth_sessions WHERE session_hash=$1", [session.session_hash]);
    return Response.json({ logged_out: true }, { headers: { "Set-Cookie": cookie(request, "", 0) } });
  }
  throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A API\u3002");
}

// site-backend/api.js
var master = { departments: ["departments", "department_id"], employees: ["employees", "employee_id"], vehicles: ["vehicles", "vehicle_id"] };
var execute2 = (sql, query, values2 = []) => sql.unsafe(query, values2);
async function find2(sql, table, key, value, lock = false) {
  const rows = await execute2(sql, `SELECT * FROM ${table} WHERE ${key}=$1${lock ? " FOR UPDATE" : ""}`, [value]);
  if (!rows[0]) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A\u8CC7\u6599\u3002");
  return rows[0];
}
async function insert(sql, table, body) {
  const keys = Object.keys(body);
  return (await execute2(sql, `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`, Object.values(body)))[0];
}
async function update(sql, table, key, value, body) {
  await find2(sql, table, key, value);
  const keys = Object.keys(body);
  return (await execute2(sql, `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE ${key}=$${keys.length + 1} RETURNING *`, [...Object.values(body), value]))[0];
}
async function saveEmployee(sql, body, value) {
  const { phone_numbers, ...data } = body;
  const row = value ? await update(sql, "employees", "employee_id", value, data) : await insert(sql, "employees", data);
  await execute2(sql, "DELETE FROM employee_phones WHERE employee_id=$1", [row.employee_id]);
  for (const phone of phone_numbers) await execute2(sql, "INSERT INTO employee_phones(employee_id,phone_number) VALUES ($1,$2)", [row.employee_id, phone]);
  if (body.password) await execute2(sql, "DELETE FROM auth_sessions WHERE employee_id=$1", [row.employee_id]);
  delete row.password;
  return { ...row, phone_numbers };
}
async function handleApi(request, env, databaseFactory = openDatabase) {
  const url = new URL(request.url), parts = url.pathname.split("/").filter(Boolean), resource = parts[1], action = parts[3], method = request.method;
  let sql;
  try {
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) throw new ApiError(405, "\u4E0D\u652F\u63F4\u7684\u64CD\u4F5C\u3002");
    if (resource === "auth") {
      sql = databaseFactory(env);
      return await handleAuth(request, sql);
    }
    if (["employee-context", "my-applications", "my-dispatches", "availability"].includes(resource) || ["vehicles", "health"].includes(resource) && method === "GET") {
      sql = databaseFactory(env);
      const session = await requireSession(request, sql);
      if (["employee-context", "my-applications", "my-dispatches", "availability"].includes(resource)) return await handleEmployeeApi(request, env, databaseFactory, session.employee_id);
    }
    const known = [...Object.keys(master), "applications", "dispatches", "maintenance", "refueling", "dashboard", "statistics", "health"];
    if (!known.includes(resource) || parts.length > 4) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A API\u3002");
    const value = parts[2] === void 0 ? null : id(Number(parts[2]));
    let body;
    if (method === "POST" || method === "PUT") {
      if (action === "review") body = validate("review", await readBody(request));
      else if (!action) body = validate(resource, await readBody(request));
      else if (!["cancel", "return"].includes(action)) throw new ApiError(404, "\u627E\u4E0D\u5230\u6307\u5B9A\u64CD\u4F5C\u3002");
    }
    sql ||= databaseFactory(env);
    let result, status = 200;
    if (method === "GET" && value === null && !action) {
      switch (resource) {
        case "health":
          await execute2(sql, "SELECT 1");
          result = { status: "ok", database: "connected", runtime: "GPT Sites Worker" };
          break;
        case "departments":
          result = await execute2(sql, "SELECT * FROM departments ORDER BY department_id");
          break;
        case "employees":
        case "vehicles":
        case "maintenance":
        case "refueling":
          result = await execute2(sql, queries[resource][0]);
          break;
        case "applications":
          result = await execute2(sql, queries.applications_base + " WHERE ($1::text IS NULL OR a.approval_status=$2) ORDER BY a.created_at DESC", [url.searchParams.get("status"), url.searchParams.get("status")]);
          break;
        case "dispatches":
          result = await execute2(sql, queries.dispatches_base + " ORDER BY ds.actual_start_date DESC");
          break;
        case "dashboard":
          result = await sql.begin("isolation level repeatable read read only", async (transaction) => {
            const data = [];
            for (const query of queries.dashboard) data.push((await execute2(transaction, query))[0]);
            return { vehicles: data[0].n, ...data[1], unreturned: data[2].n, month_cost: data[3].cost };
          });
          break;
        case "statistics":
          result = await sql.begin("isolation level repeatable read read only", async (transaction) => {
            const data = [];
            for (const query of queries.statistics) data.push(await execute2(transaction, query));
            return { approval_status: data[0], departments: data[1], months: data[2], totals: data[3][0] };
          });
          break;
      }
    } else if (method === "POST" && value === null && !action && master[resource]) {
      status = 201;
      result = await sql.begin((transaction) => resource === "employees" ? saveEmployee(transaction, body) : insert(transaction, master[resource][0], body));
    } else if (method === "PUT" && value !== null && !action && master[resource]) {
      result = await sql.begin(async (transaction) => {
        if (resource === "employees") return saveEmployee(transaction, body, value);
        if (resource === "vehicles") {
          await find2(transaction, "vehicles", "vehicle_id", value, true);
          if (body.vehicle_status !== "available" && (await execute2(transaction, "SELECT 1 FROM dispatches WHERE vehicle_id=$1 AND returned_at IS NULL", [value])).length) throw new ApiError(409, "\u8ECA\u8F1B\u6709\u672A\u6B78\u9084\u7684\u6D3E\u8ECA\u7D00\u9304\uFF0C\u8ACB\u5148\u5B8C\u6210\u6B78\u9084\u3002");
        }
        return update(transaction, master[resource][0], master[resource][1], value, body);
      });
    } else if (method === "DELETE" && value !== null && !action) {
      if (!master[resource]) throw new ApiError(405, "\u6B77\u53F2\u7D00\u9304\u4E0D\u63D0\u4F9B\u522A\u9664\uFF0C\u8ACB\u4F7F\u7528\u53D6\u6D88\u6216\u6B78\u9084\u6D41\u7A0B\u3002");
      result = await sql.begin(async (transaction) => {
        await find2(transaction, ...master[resource], value);
        await execute2(transaction, `DELETE FROM ${master[resource][0]} WHERE ${master[resource][1]}=$1`, [value]);
        return { deleted: true };
      });
    } else if (method === "POST" && resource === "applications" && value === null && !action) {
      status = 201;
      result = await sql.begin((transaction) => insert(transaction, "applications", body));
    } else if (method === "POST" && resource === "applications" && value !== null && ["review", "cancel"].includes(action)) {
      result = await sql.begin(async (transaction) => {
        const row = await find2(transaction, "applications", "application_id", value, true);
        if (action === "review") {
          if (row.approval_status !== "pending") throw new ApiError(409, "\u50C5\u5F85\u5BE9\u6838\u7533\u8ACB\u53EF\u4EE5\u6838\u51C6\u6216\u99C1\u56DE\u3002");
          return update(transaction, "applications", "application_id", value, body);
        }
        if (!["pending", "approved"].includes(row.approval_status) || (await execute2(transaction, "SELECT 1 FROM dispatches WHERE application_id=$1", [value])).length) throw new ApiError(409, "\u6B64\u7533\u8ACB\u5DF2\u7D50\u6848\u6216\u5DF2\u6D3E\u8ECA\uFF0C\u7121\u6CD5\u53D6\u6D88\u3002");
        return update(transaction, "applications", "application_id", value, { approval_status: "cancelled" });
      });
    } else if (method === "POST" && resource === "dispatches" && value === null && !action) {
      status = 201;
      result = await sql.begin(async (transaction) => {
        const owner = await find2(transaction, "applications", "application_id", body.application_id);
        await find2(transaction, "employees", "employee_id", owner.employee_id, true);
        const application = await find2(transaction, "applications", "application_id", body.application_id, true);
        const vehicle = await find2(transaction, "vehicles", "vehicle_id", body.vehicle_id, true);
        if (application.approval_status !== "approved") throw new ApiError(409, "\u8ACB\u5148\u6838\u51C6\u7533\u8ACB\uFF0C\u518D\u9032\u884C\u6D3E\u8ECA\u3002");
        if (vehicle.vehicle_status !== "available") throw new ApiError(409, "\u6B64\u8ECA\u8F1B\u76EE\u524D\u7DAD\u4FEE\u4E2D\u6216\u5DF2\u505C\u7528\u3002");
        if (Date.parse(body.actual_start_date) < new Date(application.requested_start_date).getTime() || Date.parse(body.actual_end_date) > new Date(application.requested_end_date).getTime()) throw new ApiError(409, "\u6D3E\u8ECA\u671F\u9593\u5FC5\u9808\u5728\u7533\u8ACB\u671F\u9593\u5167\u3002");
        const conflict = await execute2(
          transaction,
          `SELECT 1 FROM dispatches ds JOIN applications a USING(application_id)
          WHERE (ds.vehicle_id=$1 OR a.employee_id=$2) AND ds.actual_start_date<$3
          AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$4`,
          [body.vehicle_id, application.employee_id, body.actual_end_date, body.actual_start_date]
        );
        if (conflict.length) throw new ApiError(409, "\u8ECA\u8F1B\u6216\u54E1\u5DE5\u5728\u6B64\u671F\u9593\u5DF2\u6709\u6D3E\u8ECA\uFF0C\u8ACB\u9078\u64C7\u5176\u4ED6\u8ECA\u8F1B\u6216\u6642\u6BB5\u3002");
        return insert(transaction, "dispatches", body);
      });
    } else if (method === "POST" && resource === "dispatches" && value !== null && action === "return") {
      result = await sql.begin(async (transaction) => {
        const row = await find2(transaction, "dispatches", "dispatch_id", value, true);
        if (row.returned_at) throw new ApiError(409, "\u6B64\u6D3E\u8ECA\u5DF2\u5B8C\u6210\u6B78\u9084\u3002");
        const now = /* @__PURE__ */ new Date();
        if (now < new Date(row.actual_start_date)) throw new ApiError(409, "\u5C1A\u672A\u958B\u59CB\u4F7F\u7528\uFF0C\u4E0D\u80FD\u767B\u8A18\u6B78\u9084\u3002");
        return update(transaction, "dispatches", "dispatch_id", value, { returned_at: now.toISOString() });
      });
    } else if (method === "POST" && resource === "maintenance" && value === null && !action) {
      status = 201;
      result = await sql.begin(async (transaction) => {
        await find2(transaction, "vehicles", "vehicle_id", body.vehicle_id, true);
        return insert(transaction, "maintenance_records", body);
      });
    } else if (method === "POST" && resource === "refueling" && value === null && !action) {
      status = 201;
      result = await sql.begin((transaction) => insert(transaction, "refueling_records", body));
    } else throw new ApiError(405, "\u4E0D\u652F\u63F4\u7684\u64CD\u4F5C\u3002");
    return Response.json(result, { status });
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ detail: error.message }, { status: error.status });
    if (error.code === "23505") return Response.json({ detail: { "maintenance_records_pkey": "\u540C\u4E00\u8F1B\u8ECA\u540C\u4E00\u5929\u53EA\u80FD\u6709\u4E00\u7B46\u4FDD\u990A\u7D00\u9304\u3002", "refueling_records_pkey": "\u540C\u4E00\u8F1B\u8ECA\u540C\u4E00\u5929\u53EA\u80FD\u6709\u4E00\u7B46\u52A0\u6CB9\u7D00\u9304\u3002" }[error.constraint_name] || "\u8CC7\u6599\u91CD\u8907\uFF1A\u8ECA\u724C\u3001\u540D\u7A31\u6216\u6D3E\u8ECA\u7533\u8ACB\u5DF2\u5B58\u5728\u3002" }, { status: 409 });
    if (error.code === "23503") return Response.json({ detail: "\u95DC\u806F\u8CC7\u6599\u4E0D\u5B58\u5728\uFF0C\u6216\u6B64\u8CC7\u6599\u5DF2\u6709\u6B77\u53F2\u7D00\u9304\uFF0C\u7121\u6CD5\u522A\u9664\u3002" }, { status: 409 });
    if (error.code === "23514" || error.code === "22003") return Response.json({ detail: "\u8CC7\u6599\u4E0D\u7B26\u5408\u8CC7\u6599\u5EAB\u9650\u5236\uFF0C\u8ACB\u6AA2\u67E5\u65E5\u671F\u3001\u6578\u503C\u53CA\u5FC5\u586B\u6B04\u4F4D\u3002" }, { status: 409 });
    console.error("FleetFlow database request failed", { code: error.code || error.name });
    return Response.json({ detail: "\u8CC7\u6599\u5EAB\u66AB\u6642\u7121\u6CD5\u9023\u7DDA\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002" }, { status: 503 });
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => {
    });
  }
}

// worker.js
function createWorker(assets, apiHandler = handleApi) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    const common = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Cache-Control": "no-store" };
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) return Response.json({ detail: "\u4E0D\u652F\u63F4\u7684\u64CD\u4F5C\u3002" }, { status: 405, headers: common });
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return Response.json({ detail: "\u8ACB\u5728\u6B64\u7DB2\u7AD9\u5167\u64CD\u4F5C\u3002" }, { status: 403, headers: common });
      const resource = url.pathname.split("/")[2];
      if (!["auth", "employee-context", "my-applications", "my-dispatches", "availability", "vehicles", "health"].includes(resource) || ["vehicles", "health"].includes(resource) && request.method !== "GET") return Response.json({ detail: "\u627E\u4E0D\u5230\u6307\u5B9A API\u3002" }, { status: 404, headers: common });
      if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) return Response.json({ detail: "\u8CC7\u6599\u5EAB\u9023\u7DDA\u8A2D\u5B9A\u5C1A\u672A\u5B8C\u6210\u3002" }, { status: 503, headers: common });
      const response = await apiHandler(request, env);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(common)) headers.set(key, value);
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(response.body, { status: response.status, headers });
    }
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: common });
    const asset = assets[url.pathname === "/" ? "/index.html" : url.pathname];
    if (!asset) return new Response("Not found", { status: 404, headers: common });
    const body = asset.binary ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
    return new Response(request.method === "HEAD" ? null : body, { headers: {
      ...common,
      "Content-Type": asset.type,
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'"
    } });
  } };
}

// <stdin>
var stdin_default = createWorker({ "/index.html": { "type": "text/html; charset=utf-8", "binary": false, "body": '<!doctype html>\r\n<html lang="zh-Hant">\r\n<head>\r\n  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\r\n  <meta name="theme-color" content="#f5f5f7"><meta name="description" content="\u54E1\u5DE5\u516C\u52D9\u8ECA\u501F\u7528\uFF1A\u7533\u8ACB\u7528\u8ECA\u3001\u8FFD\u8E64\u81EA\u5DF1\u7684\u884C\u7A0B\u8207\u501F\u7528\u7D71\u8A08\u3002">\r\n  <title>FleetFlow\uFF5C\u54E1\u5DE5\u7528\u8ECA</title>\r\n  <link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="style.css">\r\n  <script src="config.js" defer></script><script src="app.js" defer></script>\r\n</head>\r\n<body>\r\n<a class="skip-link" href="#main">\u8DF3\u5230\u4E3B\u8981\u5167\u5BB9</a>\r\n<div id="boot-status" class="boot-status" role="status">\u8F09\u5165\u4E2D\u2026</div>\r\n<section id="login-screen" class="auth-screen" hidden><form id="login-form" class="auth-card"><div class="wordmark">Fleet<span>Flow</span></div><h1>\u54E1\u5DE5\u767B\u5165</h1><label for="login-employee">\u5DE5\u865F<input id="login-employee" name="employee_code" type="text" pattern="EMP[0-9]{4,19}" placeholder="EMP0001" maxlength="22" autocomplete="username" required></label><label for="login-password">\u5BC6\u78BC<input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="128" required></label><p id="login-error" class="form-error" role="alert"></p><button id="login-button" class="primary" type="submit">\u767B\u5165</button></form></section>\r\n<div id="workspace" class="workspace" hidden>\r\n  <aside class="sidebar"><a href="#overview" class="wordmark">Fleet<span>Flow</span><small>\u54E1\u5DE5\u7528\u8ECA</small></a><nav id="nav" aria-label="\u4E3B\u8981\u5C0E\u89BD"></nav><div class="sidebar-footer"><span class="avatar" id="employee-avatar">F</span><div><strong id="employee-name">\u54E1\u5DE5\u7528\u8ECA</strong><small id="employee-department">\u516C\u53F8\u516C\u52D9\u8ECA\u501F\u7528\u7CFB\u7D71</small></div></div></aside>\r\n  <div class="main-shell"><header class="topbar"><span id="breadcrumb" hidden></span><div class="topbar-right"><span id="signed-in-name"></span><button type="button" id="logout-button" class="secondary">\u767B\u51FA</button><span id="connection-state" class="connection" hidden>\u9023\u7DDA\u4E2D</span><span id="today" hidden></span></div></header>\r\n  <main id="main" tabindex="-1"><div class="page-heading"><div><h1 id="page-title">\u6211\u7684\u7528\u8ECA</h1></div><button id="add-button" class="primary" hidden>\u7533\u8ACB\u7528\u8ECA</button></div><div id="error-banner" class="error-banner" role="alert" hidden></div><div id="page-content" aria-live="polite"></div></main>\r\n  </div>\r\n</div>\r\n<dialog id="edit-dialog"><form id="edit-form"><div class="dialog-heading"><h2 id="dialog-title"></h2><button type="button" class="icon-button" id="close-dialog" aria-label="\u95DC\u9589\u8868\u55AE">\xD7</button></div><div id="form-fields"></div><p id="form-error" role="alert" class="form-error"></p><div class="dialog-actions"><button type="button" class="secondary" id="cancel-dialog">\u53D6\u6D88</button><button type="submit" class="primary" id="save-button">\u5132\u5B58</button></div></form></dialog>\r\n<div id="toast" class="toast" role="status" hidden></div>\r\n</body></html>\r\n' }, "/style.css": { "type": "text/css; charset=utf-8", "binary": false, "body": `:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","Microsoft JhengHei",sans-serif;color:#1d1d1f;background:#f5f5f7;font-size:16px;--muted:#66666e;--blue:#0066cc;--border:#e5e5ea}*{box-sizing:border-box}body{margin:0}a{color:var(--blue);text-decoration:none}button,input,textarea,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.55;cursor:wait}[hidden]{display:none!important}:focus-visible{outline:3px solid var(--blue);outline-offset:3px}h1,h2,h3,p{margin:0}h1{font-size:30px;letter-spacing:-.8px}h2{font-size:19px}h3{font-size:26px}svg{width:22px;height:22px;flex-shrink:0}.muted,.sub{color:var(--muted)}.sub{display:block;font-size:13px;margin-top:6px;line-height:1.5}.skip-link{position:fixed;top:-100px;left:16px;z-index:20;padding:12px;background:white}.skip-link:focus{top:8px}
.workspace{display:grid;grid-template-columns:218px minmax(0,1fr);min-height:100vh}.sidebar{padding:34px 18px;position:sticky;top:0;height:100vh;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column}.wordmark{font-size:25px;font-weight:700;letter-spacing:-1px;color:#1d1d1f}.wordmark span{font-weight:400}.wordmark small{display:block;font-size:12px;font-weight:400;color:var(--muted);letter-spacing:0;margin-top:7px}.sidebar>.wordmark{padding:0 14px;margin-bottom:40px}#nav{display:grid;gap:6px}.nav-item{color:#515157;display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:10px;min-height:48px;font-size:15px}.nav-item:hover{background:#f5f5f7}.nav-item.active{background:#edf4ff;color:var(--blue);font-weight:600}.sidebar-footer{margin-top:auto;padding:18px 14px 0;display:flex;gap:10px;align-items:center}.sidebar-footer strong{font-size:14px}.sidebar-footer small{display:block;color:var(--muted);font-size:12px;margin-top:4px}.avatar{width:35px;height:35px;display:grid;place-items:center;border-radius:50%;background:#f0f0f3;font-size:14px}.main-shell{min-width:0}.topbar{height:80px;display:flex;justify-content:flex-end;align-items:center;padding:0 40px}.topbar-right{display:flex;gap:18px;align-items:center;font-size:13px;color:var(--muted)}main{max-width:1200px;margin:0 auto;padding:22px 40px 60px}.page-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:30px}.primary,.secondary,.icon-button,.table-actions button{border:0;border-radius:10px;min-height:44px;padding:10px 18px;font-weight:500}.primary{background:#0066cc;color:#fff}.primary:hover{background:#0055aa}.secondary{background:#ebebef;color:#343438}.icon-button{background:transparent;font-size:26px;padding:4px 12px}.text-link{font-size:14px;font-weight:500}.panel{border:1px solid var(--border);border-radius:18px;background:white;margin-bottom:24px;overflow:hidden}.panel-heading{padding:24px;display:flex;justify-content:space-between;align-items:center;gap:12px}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px;margin-bottom:26px}.stat-card{padding:24px;background:white;border-radius:18px;border:1px solid var(--border)}.stat-card small{color:var(--muted);font-size:14px;display:block}.stat-card strong{font-size:32px;font-weight:600;display:block;margin-top:14px;letter-spacing:-1px}.trip-details{padding:0 24px 28px}.trip-details>div{display:flex;align-items:center;gap:16px}.trip-details p{margin-top:14px;font-size:17px}.trip-details dl{margin:24px 0 0;display:grid;grid-template-columns:60px 1fr;gap:12px;font-size:15px}.trip-details dt{color:var(--muted)}.trip-details dd{margin:0}.badge{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;font-size:12px;font-weight:500;border-radius:7px;padding:5px 9px;background:#f0f0f3;color:#555}.badge.approved,.badge.available,.badge.returned{background:#edf7ef;color:#236c38}.badge.upcoming,.badge.dispatched{background:#eef4ff;color:#2458a8}.badge.maintenance,.badge.pending{background:#fff4df;color:#845600}.badge.rejected,.badge.retired{background:#fff0ef;color:#a32e2e}
.toolbar{padding:20px 24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--border)}input,select,textarea{min-width:0;min-height:46px;border:1px solid #d4d4da;border-radius:9px;padding:11px 12px;background:#fff;color:#1d1d1f;max-width:100%}input::placeholder{color:#73737a}.toolbar input{flex:1;min-width:190px}.toolbar select{max-width:200px}.record-count{font-size:13px;color:var(--muted);white-space:nowrap}.table-scroll{overflow:auto;max-width:100%}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th{font-size:12px;color:var(--muted);font-weight:500;padding:15px 24px;background:#fafafa;white-space:nowrap}td{padding:20px 24px;border-top:1px solid #eeeef0;line-height:1.5}td strong{font-weight:500}.table-actions{display:flex;gap:6px;flex-wrap:nowrap}.table-actions button{padding:8px 10px;font-size:13px;background:#f2f2f5;color:var(--blue);white-space:nowrap}.table-actions .danger{color:#b42323}.empty{padding:45px 20px;display:flex;align-items:center;justify-content:center;gap:12px;color:var(--muted);font-size:14px}.empty strong{font-weight:400}.loading{padding:40px;text-align:center;color:var(--muted)}
.vehicle-picker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:28px}.vehicle-choice{text-align:left;background:white;border:1px solid var(--border);border-radius:16px;padding:20px;color:#1d1d1f;min-height:126px;transition:border-color .15s}.vehicle-choice:hover{border-color:#aaa}.vehicle-choice[aria-pressed=true]{border:2px solid var(--blue);padding:19px;background:#f3f8ff}.vehicle-choice-top{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted)}.vehicle-choice strong{display:block;font-size:21px;margin-top:20px;letter-spacing:-.4px}.vehicle-summary{padding:24px;display:flex;align-items:center;gap:24px}.vehicle-summary img{border-radius:12px;object-fit:cover;width:180px;height:112px}.vehicle-summary h2{font-size:25px}.vehicle-summary p{color:var(--muted);font-size:14px;margin-top:9px}.segmented{display:flex;background:#eeeef1;padding:4px;border-radius:10px;width:fit-content;margin:0 24px 24px;gap:2px}.segmented button{border:0;color:#555;background:transparent;border-radius:7px;min-height:44px;padding:10px 24px;font-size:14px}.segmented button[aria-pressed=true]{color:#1d1d1f;background:white;box-shadow:0 1px 4px #0001}.employee-vehicle-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:0 24px 24px}.employee-vehicle-card{border:1px solid var(--border);border-radius:12px;padding:16px;min-width:0}.employee-vehicle-card>div{display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between}.employee-vehicle-card strong{font-size:15px}.availability-form{padding:24px;display:flex;gap:16px;align-items:end}.availability-form label{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px;font-size:14px;color:var(--muted)}.availability-form input{display:block;min-width:0;width:100%;max-width:100%;min-height:46px}.availability-form button{flex-shrink:0;min-height:46px}.availability-error{padding:0 24px 24px}.cost-chart{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px;padding:8px 24px 28px}.cost-column{text-align:center;font-size:13px;color:var(--muted)}.bar-space{height:140px;display:flex;align-items:end;justify-content:center;padding:10px 0}.cost-bar{background:#0066cc;width:30px;border-radius:6px 6px 0 0}.cost-column strong{font-weight:400;font-size:12px}.status-summary{padding:0 24px 24px;display:flex;gap:32px;flex-wrap:wrap}.status-summary>div{display:flex;align-items:center;gap:12px}.status-summary strong{font-size:22px;font-weight:500}
.auth-screen{min-height:100vh;display:grid;place-items:center;padding:24px}.auth-card{background:white;border:1px solid var(--border);padding:40px;border-radius:22px;width:min(100%,400px)}.auth-card>.wordmark{margin-bottom:32px}.auth-card h1{font-size:25px;margin-bottom:26px}.auth-card label,#form-fields label{display:flex;flex-direction:column;gap:9px;font-size:14px;margin-bottom:20px}.auth-card button{width:100%;margin-top:4px}.auth-card input{width:100%}.form-error{color:#b42323;font-size:14px;line-height:1.6}.form-error:not(:empty){margin-bottom:16px}.boot-status{padding:80px;text-align:center;color:var(--muted)}dialog{padding:28px;border:1px solid var(--border);border-radius:20px;width:min(560px,calc(100% - 32px));max-height:calc(100dvh - 48px);overflow:auto}dialog::backdrop{background:#0005;backdrop-filter:blur(4px)}.dialog-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}.dialog-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:24px}#form-fields textarea{min-height:90px;resize:vertical}.form-date-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.form-date-grid input{width:100%;min-width:0;display:block}.field-hint{font-size:13px;color:#b42323;line-height:1.5}.field-hint:empty{display:none}.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);border-radius:12px;background:#252528;color:white;padding:14px 22px;font-size:14px;max-width:calc(100% - 32px);z-index:30}.error-banner{border-radius:12px;color:#a32e2e;background:#fff0ef;padding:16px;margin-bottom:24px;font-size:14px}
@media(min-width:761px) and (max-width:1100px){.workspace{grid-template-columns:190px minmax(0,1fr)}main{padding:20px 24px 50px}.topbar{padding:0 24px}.vehicle-picker,.employee-vehicle-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.availability-form{flex-wrap:wrap}.availability-form label{flex-basis:40%}}
@media(max-width:760px){.workspace{display:block}.sidebar{position:static;height:auto;padding:24px 20px 0;background:transparent;border:0;display:block}.sidebar>.wordmark{display:inline-block;padding:0;margin:0;font-size:23px}.wordmark small,.sidebar-footer{display:none}#nav{position:fixed;bottom:0;left:0;right:0;z-index:10;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;background:#fffffff2;backdrop-filter:blur(16px);border-top:1px solid var(--border);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}.nav-item{flex-direction:column;gap:5px;min-height:58px;padding:7px 0;font-size:11px;border-radius:10px;justify-content:center}.nav-item svg{width:21px;height:21px}.nav-item.active{background:transparent}.topbar{position:absolute;right:20px;top:18px;height:44px;padding:0}.topbar-right{gap:10px;font-size:12px}#logout-button{font-size:12px;padding:8px 12px}.main-shell{padding-top:24px}main{padding:14px 20px 100px}.page-heading{margin-bottom:24px}h1{font-size:27px}.page-heading>.primary{font-size:14px;padding:10px 14px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px}.stat-card{padding:20px;border-radius:15px}.stat-card strong{font-size:27px}.stats-grid .stat-card:last-child:nth-child(3){grid-column:1/-1}.panel{border-radius:15px;margin-bottom:20px}.panel-heading{padding:20px}.panel-heading h2{font-size:17px}.text-link{font-size:13px}.trip-details{padding:0 20px 24px}.trip-details h3{font-size:23px}.toolbar{padding:16px;gap:10px}.toolbar input{flex-basis:100%;min-width:0}.toolbar select{flex:1;max-width:none}.table-scroll{overscroll-behavior-x:contain}th,td{padding:16px;white-space:nowrap}.table-actions{gap:4px}.vehicle-picker{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px}.vehicle-choice{padding:16px;min-height:120px}.vehicle-choice[aria-pressed=true]{padding:15px}.vehicle-choice strong{font-size:20px;margin-top:18px}.vehicle-choice-top{gap:4px}.vehicle-choice .badge{font-size:11px;padding:4px 6px}.vehicle-summary{padding:20px;gap:15px;align-items:flex-start}.vehicle-summary img{width:96px;height:76px}.vehicle-summary h2{font-size:22px}.vehicle-summary p{font-size:12px;line-height:1.6}.segmented{margin:0 20px 20px;width:calc(100% - 40px)}.segmented button{flex:1;padding:10px 12px}.employee-vehicle-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:0 20px 20px;gap:10px}.employee-vehicle-card{padding:14px}.employee-vehicle-card>div{gap:8px}.availability-form{padding:20px;flex-direction:column;align-items:stretch;gap:18px}.availability-form label{flex:none;width:100%}.availability-form input{width:100%;max-width:100%;min-width:0}.availability-form button{align-self:stretch}.cost-chart{gap:8px;padding:0 16px 24px}.cost-column strong{font-size:10px}.cost-bar{width:22px}.bar-space{height:120px}.status-summary{padding:0 20px 24px;gap:20px}.form-date-grid{grid-template-columns:1fr;gap:0}dialog{padding:24px 20px}.auth-card{padding:32px 24px}.toast{bottom:90px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}\r
@media(max-width:760px){.vehicle-detail table{table-layout:fixed}.vehicle-detail td,.vehicle-detail th{padding:14px 12px;font-size:12px}.vehicle-detail th:first-child{width:100px}.vehicle-detail th:last-child{width:78px}.vehicle-detail td:nth-child(2){white-space:normal;overflow-wrap:anywhere}}\r
@media(max-width:760px){.applications-table,.bookings-table{display:block}.applications-table thead,.bookings-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.applications-table tbody,.bookings-table tbody{display:block;padding:0 16px}.applications-table tr,.bookings-table tr{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--border);padding:16px 0;gap:12px}.applications-table tr:last-child,.bookings-table tr:last-child{border:0}.applications-table td,.bookings-table td{padding:0;border:0;white-space:normal;min-width:0;font-size:14px}.applications-table td:nth-child(1),.applications-table td:nth-child(2),.applications-table td:nth-child(5){grid-column:1/-1}.applications-table td:nth-child(1) strong{font-size:16px}.applications-table td:nth-child(4){text-align:right}.applications-table .table-actions{gap:8px;margin-top:4px}.applications-table .table-actions button{flex:1;min-height:44px}.bookings-table td:nth-child(1){font-weight:600;font-size:16px}.bookings-table td:nth-child(2){text-align:right;color:var(--muted);font-size:13px}.bookings-table td:nth-child(3){grid-column:1/-1}.bookings-table td:nth-child(4),.bookings-table td:nth-child(5){font-size:13px}.bookings-table td:nth-child(4):before{content:'\u51FA\u767C';display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.bookings-table td:nth-child(5):before{content:'\u6B78\u9084';display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.bookings-table td[colspan],.applications-table td[colspan]{grid-column:1/-1}.bookings-table td[colspan]:before{display:none}}\r
` }, "/app.js": { "type": "text/javascript; charset=utf-8", "binary": false, "body": `'use strict';\r
const $=(selector,root=document)=>root.querySelector(selector);\r
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));\r
const paths={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',applications:'M8 3h8v4H8z M8 5H5v16h14V5h-3 M8 12h8 M8 16h5',dispatches:'M4 5h16v14H4z M4 9h16 M8 2v6 M16 2v6 M8 13h3 M14 13h2',vehicles:'M5 17H3V9l2-5h14l2 5v8h-2 M3 10h18 M7 17h10 M6 17v3 M18 17v3 M6 13h2 M16 13h2',bookings:'M4 5h16v14H4z M4 9h16 M8 2v6 M16 2v6 M8 13h3 M14 13h2',statistics:'M4 20h16 M7 16V10 M12 16V4 M17 16V7'};\r
const icon=name=>\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="\${paths[name]||paths.applications}"/></svg>\`;\r
const statusNames={pending:'\u5F85\u5BE9\u6838',approved:'\u5DF2\u6838\u51C6',rejected:'\u672A\u6838\u51C6',cancelled:'\u5DF2\u53D6\u6D88',available:'\u76EE\u524D\u53EF\u501F',maintenance:'\u4FDD\u990A\u4E2D',retired:'\u5DF2\u505C\u7528',dispatched:'\u4F7F\u7528\u4E2D',returned:'\u5DF2\u6B78\u9084',upcoming:'\u5DF2\u9810\u7D04'};\r
const badge=status=>\`<span class="badge \${esc(status)}">\${esc(statusNames[status]||status)}</span>\`;\r
const date=value=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'\u2014';\r
const views={overview:['\u6211\u7684\u7528\u8ECA'],applications:['\u6211\u7684\u7533\u8ACB'],bookings:['\u8ECA\u8F1B\u9810\u7D04'],vehicles:['\u8ECA\u8F1B\u7D00\u9304'],statistics:['\u500B\u4EBA\u7D71\u8A08']};\r
let current='overview',employeeId=null,csrfToken=null,context=null,rows=[],formMode=null,requestVersion=0,selectedVehicle=null,historyType='maintenance';\r
$('#today').textContent=new Date().toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'long',day:'numeric'});\r
async function api(path,method='GET',body){\r
  let response;try{response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(18000)});}catch{setConnection(false);throw new Error('\u7DB2\u7AD9\u66AB\u6642\u7121\u6CD5\u9023\u7DDA\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002');}\r
  const data=await response.json().catch(()=>({}));if(!response.ok){if(response.status===401&&!path.startsWith('/api/auth/'))showLogin();let detail=data.detail;if(Array.isArray(detail))detail=detail.map(v=>v.msg).join('\uFF1B');throw new Error(detail||\`\u64CD\u4F5C\u5931\u6557\uFF08\${response.status}\uFF09\`);}setConnection(true);return data;\r
}\r
function setConnection(connected){$('#connection-state').textContent=connected?'\u5DF2\u9023\u7DDA':'\u9023\u7DDA\u4E2D\u65B7';$('#connection-state').classList.toggle('offline',!connected);}\r
function personalPath(resource,record=null,action=null){return \`/api/\${resource}\${record?\`/\${record}\`:''}\${action?\`/\${action}\`:''}\`;}\r
function renderNav(){$('#nav').innerHTML=Object.entries(views).map(([key,view])=>\`<a href="#\${key}" class="nav-item \${current===key?'active':''}" \${current===key?'aria-current="page"':''}>\${icon(key)}\${view[0]}</a>\`).join('');}\r
function empty(title='\u76EE\u524D\u6C92\u6709\u7D00\u9304',description=''){return \`<div class="empty">\${icon(current)}<strong>\${esc(title)}</strong>\${description?\`<p>\${esc(description)}</p>\`:''}</div>\`;}\r
function error(message){$('#error-banner').textContent=message;$('#error-banner').hidden=false;}\r
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>{$('#toast').hidden=true;},4000);}\r
function tripStatus(trip){return trip.returned_at?'returned':new Date(trip.actual_start_date)>new Date()?'upcoming':'dispatched';}\r
function canChange(request){return !request.dispatch_id||(!request.returned_at&&new Date(request.dispatch_start_date||request.requested_start_date)>new Date());}\r
function canEdit(request){return canChange(request)&&['pending','approved'].includes(request.approval_status);}\r
function statCards(cards){return \`<div class="stats-grid">\${cards.map((card,index)=>\`<article class="stat-card \${index===1?'accent':''}"><small>\${card[0]}</small><strong>\${esc(card[1])}</strong></article>\`).join('')}</div>\`;}\r
function profile(){const person=context.employee;$('#employee-name').textContent=person.employee_name;$('#employee-department').textContent=person.department_name;$('#employee-avatar').textContent=person.employee_name.slice(0,1);$('#signed-in-name').textContent=person.employee_code;}\r
async function loadPage(){\r
  const version=++requestVersion,owner=employeeId,key=location.hash.slice(1)||'overview';current=key==='dispatches'?'applications':views[key]?key:'overview';renderNav();$('#breadcrumb').textContent=views[current][0];$('#page-title').textContent=views[current][0];\r
  $('#error-banner').hidden=true;$('#add-button').hidden=current!=='applications';$('#add-button').disabled=true;$('#add-button').textContent='\u7533\u8ACB\u7528\u8ECA';\r
  if(!owner){showLogin();return;}$('#page-content').innerHTML='<div class="loading">\u6B63\u5728\u8F09\u5165\u4F60\u7684\u7528\u8ECA\u8CC7\u6599\u2026</div>';\r
  try{const result=await api(personalPath('employee-context'));if(version!==requestVersion||owner!==employeeId)return;context=result;profile();$('#add-button').disabled=false;if(current==='overview')renderOverview();else if(current==='statistics')renderStatistics();else if(current==='vehicles')renderVehicles();else if(current==='bookings')renderBookings();else{rows=context[current];renderList();}}\r
  catch(e){if(version!==requestVersion)return;error(e.message);$('#page-content').innerHTML=empty('\u8CC7\u6599\u5C1A\u672A\u8F09\u5165','\u8ACB\u78BA\u8A8D\u9023\u7DDA\u5F8C\u91CD\u65B0\u6574\u7406\u9801\u9762\u3002');}\r
}\r
function renderOverview(){\r
  const {applications,dispatches}=context,next=dispatches.filter(t=>!t.returned_at).sort((a,b)=>new Date(a.actual_start_date)-new Date(b.actual_start_date))[0];\r
  $('#page-content').innerHTML=\`\${statCards([['\u6211\u7684\u7533\u8ACB',applications.length],['\u5C1A\u672A\u6B78\u9084',dispatches.filter(t=>!t.returned_at).length],['\u5DF2\u5B8C\u6210',dispatches.filter(t=>t.returned_at).length]])}<section class="panel next-trip"><div class="panel-heading"><h2>\u4E0B\u4E00\u8D9F\u884C\u7A0B</h2><a href="#applications" class="text-link">\u6211\u7684\u7533\u8ACB \u2192</a></div>\${next?\`<div class="trip-details"><div><h3>\${esc(next.license_plate)}</h3>\${badge(tripStatus(next))}</div><p>\${esc(next.purpose)}</p><dl><dt>\u51FA\u767C</dt><dd>\${date(next.actual_start_date)}</dd><dt>\u6B78\u9084</dt><dd>\${date(next.actual_end_date)}</dd></dl></div>\`:empty('\u76EE\u524D\u6C92\u6709\u884C\u7A0B')}</section>\`;\r
}\r
function requestStatus(request){return request.approval_status==='approved'&&request.dispatch_id?tripStatus({actual_start_date:request.dispatch_start_date,returned_at:request.returned_at}):request.approval_status;}\r
const columns={applications:[['\u7533\u8ACB / \u7528\u9014',a=>\`<strong>\${esc(a.purpose)}</strong><span class="sub">#\${a.application_id}</span>\`],['\u4F7F\u7528\u671F\u9593',a=>\`\${date(a.dispatch_start_date||a.requested_start_date)}<span class="sub">\u81F3 \${date(a.dispatch_end_date||a.requested_end_date)}</span>\`],['\u72C0\u614B',a=>\`\${badge(requestStatus(a))}\${a.returned_at?\`<span class="sub">\${date(a.returned_at)}</span>\`:''}\`],['\u8ECA\u724C',a=>esc(a.license_plate||'\u5C1A\u672A\u6307\u6D3E')]]};\r
function actions(row){\r
  if(row.dispatch_id&&!row.returned_at&&new Date(row.dispatch_start_date)<=new Date())return \`<div class="table-actions"><button type="button" data-action="return" data-id="\${row.dispatch_id}">\u767B\u8A18\u6B78\u9084</button></div>\`;\r
  const button=(label,action,danger=false)=>\`<button type="button" data-action="\${action}" data-id="\${row.application_id}" class="\${danger?'danger':''}">\${label}</button>\`;\r
  return \`<div class="table-actions">\${canEdit(row)?button('\u4FEE\u6539','edit'):''}\${canEdit(row)?button('\u53D6\u6D88','cancel'):''}\${canChange(row)?button('\u522A\u55AE','delete',true):'<span class="muted">\u5DF2\u5B8C\u6210</span>'}</div>\`;\r
}\r
function renderList(){\r
  const filter=\`<select id="status-filter" aria-label="\u7533\u8ACB\u72C0\u614B\u7BE9\u9078"><option value="">\u5168\u90E8\u72C0\u614B</option>\${['pending','approved','upcoming','dispatched','returned','rejected','cancelled'].map(v=>\`<option value="\${v}">\${v==='approved'?'\u5DF2\u6838\u51C6\uFF08\u5168\u90E8\uFF09':statusNames[v]}</option>\`).join('')}</select>\`;\r
  $('#page-content').innerHTML=\`<section class="panel"><div class="toolbar"><input type="search" id="search" placeholder="\u641C\u5C0B\u7528\u9014\u3001\u8ECA\u724C\u6216\u55AE\u865F\u2026" aria-label="\u641C\u5C0B\u6211\u7684\u7D00\u9304">\${filter}<span class="record-count" id="record-count"></span></div><div class="table-scroll"><table class="applications-table"><thead><tr>\${columns[current].map(c=>\`<th>\${c[0]}</th>\`).join('')}<th>\u64CD\u4F5C</th></tr></thead><tbody id="list-body"></tbody></table></div></section>\`;$('#search').addEventListener('input',filterRows);$('#status-filter').addEventListener('change',filterRows);filterRows();\r
}\r
function filterRows(){\r
  const search=$('#search').value.trim().toLowerCase(),status=$('#status-filter').value,filtered=rows.filter(row=>Object.values(row).join(' ').toLowerCase().includes(search)&&(!status||(status==='approved'?row.approval_status:requestStatus(row))===status));$('#record-count').textContent=\`\${filtered.length} \u7B46\`;\r
  $('#list-body').innerHTML=filtered.length?filtered.map(row=>\`<tr>\${columns[current].map(c=>\`<td>\${c[1](row)}</td>\`).join('')}<td>\${actions(row)}</td></tr>\`).join(''):\`<tr><td colspan="\${columns[current].length+1}">\${empty(search||status?'\u6C92\u6709\u7B26\u5408\u7684\u7D50\u679C':current==='applications'?'\u5C1A\u7121\u7533\u8ACB':'\u5C1A\u7121\u884C\u7A0B')}</td></tr>\`;\r
}\r
function vehicleHistory(){\r
  const vehicle=context.vehicles.find(v=>String(v.vehicle_id)===selectedVehicle);\r
  if(!vehicle)return '';\r
  const maintenance=historyType==='maintenance',dateKey=maintenance?'maintenance_date':'refueling_date';\r
  const records=(context[historyType]||[]).filter(r=>String(r.vehicle_id)===selectedVehicle).sort((a,b)=>String(b[dateKey]).localeCompare(String(a[dateKey])));\r
  return \`<section class="panel vehicle-detail" aria-labelledby="selected-plate"><div class="vehicle-summary"><img src="/cullinan.webp" alt="Rolls-Royce Cullinan" width="180" height="112"><div><h2 id="selected-plate">\${esc(vehicle.license_plate)}</h2><p>\${esc(vehicle.vehicle_model)}</p></div></div><div class="segmented" role="group" aria-label="\u7D00\u9304\u985E\u578B"><button type="button" data-history="maintenance" aria-pressed="\${maintenance}">\u4FDD\u990A\u7D00\u9304</button><button type="button" data-history="refueling" aria-pressed="\${!maintenance}">\u52A0\u6CB9\u7D00\u9304</button></div><div class="table-scroll"><table aria-label="\${esc(vehicle.license_plate)}\${maintenance?'\u4FDD\u990A':'\u52A0\u6CB9'}\u7D00\u9304"><thead><tr><th>\u65E5\u671F</th><th>\${maintenance?'\u4FDD\u990A\u9805\u76EE':'\u516C\u5347\u6578'}</th><th>\u91D1\u984D</th></tr></thead><tbody>\${records.length?records.map(r=>\`<tr><td>\${esc(String(r[dateKey]).slice(0,10))}</td><td>\${maintenance?esc(r.maintenance_item):Number(r.fuel_liters).toLocaleString('zh-TW',{maximumFractionDigits:3})+' L'}</td><td>\${Number(maintenance?r.maintenance_cost:r.fuel_cost).toLocaleString('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0})}</td></tr>\`).join(''):\`<tr><td colspan="3">\${empty('\u5C1A\u7121\u7D00\u9304')}</td></tr>\`}</tbody></table></div></section>\`;\r
}\r
function renderVehicles(){\r
  if(!context.vehicles.some(v=>String(v.vehicle_id)===selectedVehicle))selectedVehicle=null;\r
  $('#page-content').innerHTML=\`<div class="vehicle-picker" role="group" aria-label="\u9078\u64C7\u8ECA\u8F1B">\${context.vehicles.map(v=>\`<button type="button" class="vehicle-choice" data-vehicle="\${v.vehicle_id}" aria-pressed="\${String(v.vehicle_id)===selectedVehicle}"><span class="vehicle-choice-top">\${icon('vehicles')}\${badge(v.in_use?'dispatched':v.vehicle_status)}</span><strong>\${esc(v.license_plate)}</strong></button>\`).join('')}</div><div id="vehicle-history">\${vehicleHistory()}</div>\`;\r
  $('.vehicle-picker').addEventListener('click',event=>{const button=event.target.closest('[data-vehicle]');if(!button)return;selectedVehicle=button.dataset.vehicle;historyType='maintenance';$$vehicleSelection();});\r
  $('#vehicle-history').addEventListener('click',event=>{const button=event.target.closest('[data-history]');if(!button)return;historyType=button.dataset.history;$('#vehicle-history').innerHTML=vehicleHistory();$(\`[data-history="\${historyType}"]\`).focus();});\r
}\r
function $$vehicleSelection(){document.querySelectorAll('[data-vehicle]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.vehicle===selectedVehicle)));$('#vehicle-history').innerHTML=vehicleHistory();}\r
let availabilityVersion=0,formAvailabilityVersion=0;\r
const periodQuery=(start,end)=>\`/api/availability?start=\${encodeURIComponent(start)}&end=\${encodeURIComponent(end)}\`;\r
function bookingsTable(records){return \`<div class="table-scroll"><table class="bookings-table"><thead><tr><th>\u8ECA\u724C</th><th>\u54E1\u5DE5</th><th>\u7528\u9014</th><th>\u51FA\u767C</th><th>\u6B78\u9084</th></tr></thead><tbody>\${records.length?records.map(r=>\`<tr><td>\${esc(r.license_plate)}</td><td>\${esc(r.employee_name)}</td><td>\${esc(r.purpose)}</td><td>\${date(r.actual_start_date)}</td><td>\${date(r.actual_end_date)}</td></tr>\`).join(''):\`<tr><td colspan="5">\${empty('\u5C1A\u7121\u9810\u7D04')}</td></tr>\`}</tbody></table></div>\`;}\r
function renderBookings(){const start=localTime(new Date(Date.now()+3600000)),end=localTime(new Date(Date.now()+10800000));$('#page-content').innerHTML=\`<section class="panel"><form id="availability-form" class="availability-form"><label for="availability-start">\u51FA\u767C<input id="availability-start" type="datetime-local" value="\${start}" required></label><label for="availability-end">\u6B78\u9084<input id="availability-end" type="datetime-local" value="\${end}" required></label><button class="primary" type="submit">\u67E5\u7A7A\u8ECA</button></form><div id="availability-result" aria-live="polite"></div></section><section class="panel"><div class="panel-heading"><h2>\u5927\u5BB6\u7684\u9810\u7D04</h2></div>\${bookingsTable(context.team_bookings||[])}</section>\`;$('#availability-form').addEventListener('submit',event=>{event.preventDefault();checkAvailability();});checkAvailability();}\r
async function checkAvailability(){const version=++availabilityVersion;$('#availability-result').innerHTML='<div class="loading">\u67E5\u8A62\u4E2D\u2026</div>';try{const data=await api(periodQuery(new Date($('#availability-start').value+':00+08:00').toISOString(),new Date($('#availability-end').value+':00+08:00').toISOString()));if(version!==availabilityVersion||current!=='bookings')return;$('#availability-result').innerHTML=\`<div class="employee-vehicle-grid">\${data.vehicles.map(v=>\`<article class="employee-vehicle-card"><div><strong>\${esc(v.license_plate)}</strong><span class="badge \${v.available_in_period?'available':'maintenance'}">\${v.available_in_period?'\u53EF\u501F':v.vehicle_status==='maintenance'?'\u4FDD\u990A\u4E2D':'\u5DF2\u9810\u7D04'}</span></div></article>\`).join('')}</div>\`;}catch(e){if(version===availabilityVersion&&current==='bookings')$('#availability-result').innerHTML=\`<div class="form-error availability-error" role="alert">\${esc(e.message)}</div>\`;}}\r
async function refreshFormVehicles(){const version=++formAvailabilityVersion,select=$('#field-vehicle'),owner=employeeId;if(!select)return;const selected=select.value;select.disabled=true;$('#vehicle-hint').textContent='';try{const data=await api(periodQuery(new Date($('#field-start').value+':00+08:00').toISOString(),new Date($('#field-end').value+':00+08:00').toISOString())+(formMode.record?'&exclude='+formMode.record.application_id:''));if(version!==formAvailabilityVersion||owner!==employeeId||!$('#edit-dialog').open)return;select.innerHTML='<option value="">\u81EA\u52D5\u5B89\u6392</option>'+data.vehicles.map(v=>\`<option value="\${v.vehicle_id}" \${!v.available_in_period?'disabled':''}>\${esc(v.license_plate)}\${v.available_in_period?'':'\uFF08\u7121\u6CD5\u501F\u7528\uFF09'}</option>\`).join('');if(data.vehicles.some(v=>String(v.vehicle_id)===selected&&v.available_in_period))select.value=selected;$('#vehicle-hint').textContent=data.vehicles.some(v=>v.available_in_period)?'':'\u6B64\u6642\u6BB5\u7121\u53EF\u501F\u8ECA\u8F1B\u3002';}catch(e){if(version===formAvailabilityVersion&&$('#edit-dialog').open)$('#vehicle-hint').textContent=e.message;}finally{if(version===formAvailabilityVersion&&$('#edit-dialog').open)select.disabled=false;}}\r
function renderStatistics(){\r
  const data=context.statistics,s=data.totals,max=Math.max(1,...data.months.map(m=>m.applications));$('#page-content').innerHTML=\`\${statCards([['\u7D2F\u8A08\u7533\u8ACB',s.applications],['\u7528\u8ECA\u6B21\u6578',s.dispatches],['\u5DF2\u6B78\u9084',s.returned],['\u9810\u7D04\u6642\u6578',s.scheduled_hours+' \u5C0F\u6642']])}<section class="panel"><div class="panel-heading"><h2>\u8FD1\u516D\u500B\u6708\u7533\u8ACB</h2></div><div class="cost-chart" role="list" aria-label="\u6BCF\u6708\u7533\u8ACB\u6578">\${data.months.map(m=>\`<div class="cost-column" role="listitem" aria-label="\${esc(m.month)}\uFF1A\${m.applications} \u7B46\u7533\u8ACB"><span>\${m.applications}</span><div class="bar-space"><div class="cost-bar" style="height:\${Math.max(2,m.applications/max*100)}%"></div></div><strong>\${esc(m.month)}</strong></div>\`).join('')}</div></section><section class="panel"><div class="panel-heading"><h2>\u7533\u8ACB\u72C0\u614B</h2></div><div class="status-summary">\${data.approval_status.map(v=>\`<div>\${badge(v.approval_status)}<strong>\${v.count}</strong></div>\`).join('')||empty('\u5C1A\u7121\u7533\u8ACB')}</div></section>\`;\r
}\r
function localTime(value){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)),get=type=>parts.find(p=>p.type===type).value;return \`\${get('year')}-\${get('month')}-\${get('day')}T\${get('hour')}:\${get('minute')}\`;}\r
function openForm(record=null){\r
  if(!context||!employeeId)return;formMode={owner:employeeId,record};const start=record?.requested_start_date||new Date(Date.now()+3600000).toISOString(),end=record?.requested_end_date||new Date(Date.now()+10800000).toISOString();$('#dialog-title').textContent=record?'\u4FEE\u6539\u6211\u7684\u7533\u8ACB':'\u7533\u8ACB\u516C\u52D9\u7528\u8ECA';$('#form-error').textContent='';$('#save-button').textContent=record?'\u5132\u5B58':'\u9001\u51FA\u7533\u8ACB';\r
  $('#form-fields').innerHTML=\`<label for="field-purpose">\u501F\u7528\u7528\u9014<textarea id="field-purpose" name="purpose" required maxlength="500" >\${esc(record?.purpose||'')}</textarea></label><div class="form-date-grid"><label for="field-start">\u9810\u8A08\u51FA\u767C<input id="field-start" name="requested_start_date" type="datetime-local" value="\${localTime(start)}" required></label><label for="field-end">\u9810\u8A08\u6B78\u9084<input id="field-end" name="requested_end_date" type="datetime-local" value="\${localTime(end)}" required></label></div><label for="field-vehicle">\u8ECA\u8F1B<select id="field-vehicle" name="vehicle_id"><option value="">\u81EA\u52D5\u5B89\u6392</option>\${record?.vehicle_id?\`<option value="\${record.vehicle_id}" selected>\${esc(record.license_plate)}</option>\`:''}</select></label><p class="field-hint" id="vehicle-hint" role="status"></p>\`;$('#edit-dialog').showModal();$('#field-start').addEventListener('change',refreshFormVehicles);$('#field-end').addEventListener('change',refreshFormVehicles);refreshFormVehicles();\r
}\r
$('#add-button').addEventListener('click',()=>openForm());$('#close-dialog').addEventListener('click',()=>$('#edit-dialog').close());$('#cancel-dialog').addEventListener('click',()=>$('#edit-dialog').close());\r
$('#edit-form').addEventListener('submit',async event=>{\r
  event.preventDefault();$('#save-button').disabled=true;$('#form-error').textContent='';try{const fields=Object.fromEntries(new FormData(event.target)),body={employee_id:formMode.owner,purpose:fields.purpose,requested_start_date:new Date(fields.requested_start_date+':00+08:00').toISOString(),requested_end_date:new Date(fields.requested_end_date+':00+08:00').toISOString(),...(fields.vehicle_id?{vehicle_id:Number(fields.vehicle_id)}:{})};const result=await api(personalPath('my-applications',formMode.record?.application_id,null,formMode.owner),formMode.record?'PUT':'POST',body);$('#edit-dialog').close();toast(\`\u7533\u8ACB\u5DF2\u81EA\u52D5\u6838\u51C6\uFF0C\u8ECA\u724C\uFF1A\${result.license_plate}\`);if(location.hash==='#applications')await loadPage();else location.hash='applications';}catch(e){$('#form-error').textContent=e.message;}finally{$('#save-button').disabled=false;}\r
});\r
$('#page-content').addEventListener('click',async event=>{\r
  const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,id=Number(button.dataset.id);if(action==='new')return openForm();if(action==='edit')return openForm(context.applications.find(a=>a.application_id===id));const prompt={delete:'\u522A\u9664\u7533\u8ACB\u4E26\u91CB\u653E\u9810\u7D04\uFF1F\u7121\u6CD5\u5FA9\u539F\u3002',cancel:'\u53D6\u6D88\u7533\u8ACB\u4E26\u91CB\u653E\u9810\u7D04\uFF1F',return:'\u78BA\u8A8D\u6B78\u9084\uFF1F'}[action];if(!prompt||!confirm(prompt))return;button.disabled=true;\r
  try{if(action==='delete')await api(personalPath('my-applications',id),'DELETE');else if(action==='cancel')await api(personalPath('my-applications',id,'cancel'),'POST');else await api(personalPath('my-dispatches',id,'return'),'POST');toast(action==='delete'?'\u7533\u8ACB\u5DF2\u522A\u9664\uFF0C\u8ECA\u8F1B\u9810\u7D04\u5DF2\u91CB\u653E':action==='cancel'?'\u7533\u8ACB\u5DF2\u53D6\u6D88':'\u5DF2\u5B8C\u6210\u6B78\u9084');await loadPage();}catch(e){error(e.message);button.disabled=false;}\r
});\r
function showLogin(){requestVersion++;availabilityVersion++;employeeId=null;csrfToken=null;context=null;selectedVehicle=null;historyType='maintenance';$('#workspace').hidden=true;$('#login-screen').hidden=false;$('#boot-status').hidden=true;$('#page-content').innerHTML='';if($('#edit-dialog').open)$('#edit-dialog').close();$('#login-password').value='';}\r
function showWorkspace(session){employeeId=session.employee.employee_id;csrfToken=session.csrf_token;$('#signed-in-name').textContent=session.employee.employee_code;$('#login-screen').hidden=true;$('#workspace').hidden=false;$('#boot-status').hidden=true;}\r
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('#login-button');button.disabled=true;$('#login-error').textContent='';try{const session=await api('/api/auth/login','POST',{employee_code:$('#login-employee').value.trim().toUpperCase(),password:$('#login-password').value});$('#login-password').value='';showWorkspace(session);await loadPage();}catch(e){$('#login-error').textContent=e.message;}finally{button.disabled=false;}});\r
$('#logout-button').addEventListener('click',async()=>{try{await api('/api/auth/logout','POST');showLogin();$('#login-employee').focus();}catch(e){error(e.message);}});\r
window.addEventListener('hashchange',()=>{if(employeeId)loadPage();});\r
window.addEventListener('pageshow',event=>{if(event.persisted)initialize();});\r
async function initialize(){try{const session=await api('/api/auth/session');showWorkspace(session);await loadPage();}catch(e){showLogin();if(e.message!=='\u8ACB\u5148\u767B\u5165\u3002'&&!e.message.includes('\u767B\u5165\u5DF2\u5931\u6548'))$('#login-error').textContent=e.message;}}\r
initialize();\r
` }, "/config.js": { "type": "text/javascript; charset=utf-8", "binary": false, "body": "// Frontend uses same-origin GPT Sites API. No browser database credentials.\r\n" }, "/favicon.svg": { "type": "image/svg+xml", "binary": false, "body": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#1438a6"/><path d="M18 45V19h29v7H26v5h16v7H26v7z" fill="white"/></svg>\n' }, "/cullinan.webp": { "type": "image/webp", "binary": true, "body": "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" } });
export {
  stdin_default as default
};
