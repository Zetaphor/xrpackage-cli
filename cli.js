#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const http = require('http');
const {Writable} = require('stream');
const os = require('os');

const read = require('read');
const mkdirp = require('mkdirp');
const yargs = require('yargs');
const fetch = require('node-fetch');
const mime = require('mime');
const wbn = require('wbn');
const ethereumjs = {
  Tx: require('ethereumjs-tx').Transaction,
};
const {BigNumber} = require('bignumber.js');
const lightwallet = require('eth-lightwallet');
const Web3 = require('web3');
const express = require('express');
const opn = require('opn');

const apiHost = `https://ipfs.exokit.org/ipfs`;
const tokenHost = `https://tokens.webaverse.com`;
const network = 'rinkeby';
const infuraApiKey = '4fb939301ec543a0969f3019d74f80c2';
const rpcUrl = `https://${network}.infura.io/v3/${infuraApiKey}`;
const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));

const getContract = Promise.all([
  fetch(`https://contracts.webaverse.com/address.js`).then(res => res.text()).then(s => s.replace(/^export default `(.+?)`[\s\S]*$/, '$1')),
  fetch(`https://contracts.webaverse.com/abi.js`).then(res => res.text()).then(s => JSON.parse(s.replace(/^export default /, ''))),
]).then(([address, abi]) => {
  // console.log('got address + abi', {address, abi});
  return new web3.eth.Contract(abi, address);
});

/* loadPromise.then(c => {
  const m = c.methods.mint([1, 1, 1], '0x0', 'hash', 'lol');
  console.log('got c', Object.keys(c), Object.keys(c.methods.mint), Object.keys(m), m.encodeABI());
}); */

/* window.web3.eth.contract(abi).at(address)
window.web3 = new window.Web3(window.ethereum);
try {
  // Request account access if needed
  await window.ethereum.enable();
  // Acccounts now exposed
  // web3.eth.sendTransaction({});

  this.instance = ;
  this.account = window.web3.eth.accounts[0];

  this.promise.accept(this.instance);
} catch (err) {
  // User denied account access...
  console.warn(err);
} */

function makePromise() {
  let accept, reject;
  const p = new Promise((a, r) => {
    accept = a;
    reject = r;
  });
  p.accept = accept;
  p.reject = reject;
  return p;
}
async function getKs() {
  const ksString = fs.readFileSync(path.join(os.homedir(), '.xrpackage'));
  const passwordPromise = makePromise();
  read({ prompt: 'password: ', silent: true }, function(er, password) {
    if (!er) {
      passwordPromise.accept(password);
    } else {
      passwordPromise.reject(er);
    }
  });
  const password = await passwordPromise;
  const ks = await _importKeyStore(ksString, password);
  return ks;
}
const hdPathString = `m/44'/60'/0'/0`;
async function exportSeed(ks, password) {
  const p = makePromise();
  ks.keyFromPassword(password, function (err, pwDerivedKey) {
    if (!err) {
      const seed = ks.getSeed(pwDerivedKey);
      p.accept(seed);
    } else {
      p.reject(err);
    }
  });
  return await p;
}
async function signTx(ks, password, rawTx) {
  const p = makePromise();
  ks.keyFromPassword(password, function (err, pwDerivedKey) {
    if (!err) {
      const address = ks.addresses[0];
      console.log('sign tx', ks, pwDerivedKey, rawTx, address, hdPathString);
      const signed = lightwallet.signing.signTx(ks, pwDerivedKey, rawTx, `0x${address}`, hdPathString);
      p.accept(signed);
    } else {
      p.reject(err);
    }
  });
  return await p;
}
async function getPrivateKey(ks, password) {
  const p = makePromise();
  ks.keyFromPassword(password, function (err, pwDerivedKey) {
    if (!err) {
      const privateKey = ks.exportPrivateKey(ks.addresses[0], pwDerivedKey);
      p.accept(privateKey);
    } else {
      p.reject(err);
    }
  });
  return await p;
}
const _createKeystore = async (seedPhrase, password) => {
  const p = makePromise();
  lightwallet.keystore.createVault({
    password,
    seedPhrase, // Optionally provide a 12-word seed phrase
    // salt: fixture.salt,     // Optionally provide a salt.
                               // A unique salt will be generated otherwise.
    hdPathString,    // Optional custom HD Path String
  },
  (err, ks) => {
    if (!err) {
      ks.keyFromPassword(password, function (err, pwDerivedKey) {
        if (!err) {
          ks.generateNewAddress(pwDerivedKey, 1);

          p.accept(ks);
        } else {
          p.reject(err);
        }
      });
    } else {
      p.reject(err);
    }
  });
  const ks = await p;
  ks.exportSeed = exportSeed.bind(null, ks, password);
  ks.signTx = signTx.bind(null, ks, password);
  ks.getPrivateKey = getPrivateKey.bind(null, ks, password);
  return ks;
};
const _exportKeyStore = ks => ks.serialize();
const _importKeyStore = async (s, password) => {
  const ks = lightwallet.keystore.deserialize(s);

  const p = makePromise();
  ks.keyFromPassword(password, function (err, pwDerivedKey) {
    if (!err) {
      if (ks.isDerivedKeyCorrect(pwDerivedKey)) {
        p.accept();
      } else {
        p.reject(new Error('invalid password'));
      }
    } else {
      p.reject(err);
    }
  });
  await p;
  ks.exportSeed = exportSeed.bind(null, ks, password);
  ks.signTx = signTx.bind(null, ks, password);
  ks.getPrivateKey = getPrivateKey.bind(null, ks, password);
  return ks;
};

let handled = false;
yargs
  .command('whoami', 'print logged in address', yargs => {
    yargs
      /* .positional('input', {
        describe: 'input file to build',
        // default: 5000
      }) */
  }, async argv => {
    handled = true;

    const ks = await getKs();

    console.log(`0x${ks.addresses[0]}`);
  })
  .command('privatekey', 'export private key menmonic', yargs => {
    yargs
      /* .positional('input', {
        describe: 'input file to build',
        // default: 5000
      }) */
  }, async argv => {
    handled = true;

    const ks = await getKs();

    const seed = await ks.exportSeed();
    console.log(seed);
  })
  .command('login', 'log in to wallet', yargs => {
    yargs
      /* .positional('input', {
        describe: 'input file to build',
        // default: 5000
      }) */
  }, async argv => {
    handled = true;

    const mutableStdout = new Writable({
      write: function(chunk, encoding, callback) {
        if (!this.muted)
          process.stdout.write(chunk, encoding);
        callback();
      }
    });
    mutableStdout.muted = false;
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });

    const p = makePromise();
    rl.question('seed phrase (default: autogen): ', seedPhrase => {
      if (!seedPhrase) {
        seedPhrase = lightwallet.keystore.generateRandomSeed();
        console.log(seedPhrase);
      }

      rl.question('password: ', async password => {
        rl.close();

        if (password) {
          const ks = await _createKeystore(seedPhrase, password);
          await mkdirp(os.homedir());
          fs.writeFile(path.join(os.homedir(), '.xrpackage'), _exportKeyStore(ks), err => {
            p.accept();
          });
          console.log(`0x${ks.addresses[0]}`);
        } else {
          p.reject(new Error('password is required'));
        }
      });
    });
    await p;
    mutableStdout.muted = true;
  })
  .command('publish [input]', 'publish a package', yargs => {
    yargs
      .positional('input', {
        describe: '.wbn package to publish',
        // default: 5000
      })
  }, async argv => {
    handled = true;

    const ks = await getKs();

    const objectName = path.basename(argv.input);
    const dataArrayBuffer = fs.readFileSync(argv.input);
    const screenshotBlob = fs.readFileSync(argv.input + '.gif');
    const modelBlob = fs.readFileSync(argv.input + '.glb');

    console.log('uploading...');
    const [
      dataHash,
      screenshotHash,
      modelHash,
    ] = await Promise.all([
      fetch(`${apiHost}/`, {
        method: 'PUT',
        body: dataArrayBuffer,
      })
        .then(res => res.json())
        .then(j => j.hash),
      fetch(`${apiHost}/`, {
        method: 'PUT',
        body: screenshotBlob,
      })
        .then(res => res.json())
        .then(j => j.hash),
      fetch(`${apiHost}/`, {
        method: 'PUT',
        body: modelBlob,
      })
        .then(res => res.json())
        .then(j => j.hash),
    ]);
    const metadataHash = await fetch(`${apiHost}/`, {
      method: 'PUT',
      body: JSON.stringify({
        objectName,
        dataHash,
        screenshotHash,
        modelHash,
      }),
    })
      .then(res => res.json())
      .then(j => j.hash);

    /* const address = `0x${ks.addresses[0]}`;
    const nonce = await web3.eth.getTransactionCount(address);
    const gasPrice = await web3.eth.getGasPrice();
    const rawTx = {
      to: dstAddress,
      srcValue: srcValue * 1e18,
      gasPrice,
      gas: 0,
      nonce,
    };
    rawTx.gas = await web3.eth.estimateGas(rawTx);
    const serializedTx = new ethereumjs.Tx(rawTx).serialize();
    const signed = await ks.signTx(serializedTx);
    web3.eth.sendSignedTransaction('0x' + signed).on('receipt', e => {
      console.log('got tx receipt', e); // XXX
    }); */

    console.log(`${apiHost}/${dataHash}.wbn`);
    console.log(`${apiHost}/${screenshotHash}.gif`);
    console.log(`${apiHost}/${modelHash}.glb`);
    console.log(`${apiHost}/${metadataHash}.json`);

    console.log('minting...');
    const contract = await getContract;
    const address = `0x${ks.addresses[0]}`;
    const privateKey = await ks.getPrivateKey();
    // console.log('got pk', privateKey);
    // web3.eth.accounts.wallet.add('0x' + Buffer.from(privateKey).toString('hex'));
    const account = web3.eth.accounts.privateKeyToAccount('0x' + privateKey);
    web3.eth.accounts.wallet.add(account);

    const nonce = await web3.eth.getTransactionCount(address);
    const gasPrice = await web3.eth.getGasPrice();
    // const value = '10000000000000000'; // 0.01 ETH

    const m = contract.methods.mint(1, 'hash', metadataHash);
    const o = {
      gas: 0,
      from: address,
      nonce,
      // value,
    };
    o.gas = await m.estimateGas(o);
    const receipt = await m.send(o);
    const id = parseInt(receipt.events.URI.returnValues[1], 10);
    console.log(`${tokenHost}/${id}`);
    console.log(`https://${network}.opensea.io/assets/${contract._address}/${id}`);
  })
  .command('ls', 'list wallet inventory', yargs => {
    yargs
      /* .positional('id', {
        describe: 'id of package to install',
        // default: 5000
      }) */
  }, async argv => {
    handled = true;

    const ks = await getKs();

    const contract = await getContract;
    const owner = '0x' + ks.addresses[0];
    const owners = Array(100);
    const ids = Array(owners.length);
    for (let i = 0; i < ids.length; i++) {
      owners[i] = owner;
      ids[i] = i+1;
    }
    const balances = await contract.methods.balanceOfBatch(owners, ids).call();
    const ownedIds = balances.map((balance, id) => {
      balance = parseInt(balance, 10);
      if (balance > 0) {
        return id;
      } else {
        return null;
      }
    }).filter(id => id !== null);
    const objects = [];
    for (let i = 0; i < ownedIds.length; i++) {
      const id = ownedIds[i];
      const metadataHash = await contract.methods.getMetadata(id, 'hash').call();
      const metadata = await fetch(`${apiHost}/${metadataHash}`)
        .then(res => res.json());
      const {objectName, dataHash} = metadata;
      objects.push({
        id,
        objectName,
        dataHash,
      });
    }
    for (let i = 0; i < ownedIds.length; i++) {
      const object = objects[i];
      console.log(object.id + ' ' + JSON.stringify(object.objectName) + ' ' + `${apiHost}/${object.dataHash}.wbn`);
    }
    /* const nonce = await contract.methods.getNonce().call();
    console.log(nonce); */
  })
  .command('count', 'get count of published packages', yargs => {
    yargs
      /* .positional('id', {
        describe: 'id of package to install',
        // default: 5000
      }) */
  }, async argv => {
    handled = true;

    const contract = await getContract;
    const nonce = await contract.methods.getNonce().call();
    console.log(nonce);
  })
  .command('run [id]', 'run a package in browser', yargs => {
    yargs
      /* .positional('id', {
        describe: 'id of package to install',
        // default: 5000
      }) */
  }, async argv => {
    handled = true;

    if (!isNaN(parseInt(argv.id, 10))) {
      opn(`https://xrpackage.org/run.html?i=${argv.id}`);
    } else {
      const app = express();
      app.get('/a.wbn', (req, res) => {
        const rs = fs.createReadStream(argv.id);
        rs.pipe(res);
        rs.once('error', err => {
          res.statusCode = 500;
          res.end(err.stack);
        });
      });
      app.use(express.static(__dirname));
      const port = 9999;
      const server = http.createServer(app);
      server.listen(port, () => {
        opn(`http://localhost:${port}/run.html?u=/a.wbn`);
      });
    }
  })
  .command('install [id]', 'install package with given id', yargs => {
    yargs
      .positional('id', {
        describe: 'id of package to install',
        // default: 5000
      })
  }, async argv => {
    handled = true;

    const contract = await getContract;

    const metadataHash = await contract.methods.getMetadata(parseInt(argv.id, 10), 'hash').call();
    const metadata = await fetch(`${apiHost}/${metadataHash}`)
      .then(res => res.json());
    // console.log(metadata);
    const {dataHash, screenshotHash, modelHash} = metadata;

    console.log('downloading...');
    await Promise.all([
      fetch(`${apiHost}/${dataHash}`)
        .then(res => res.arrayBuffer())
        .then(arrayBuffer => {
          fs.writeFileSync('a.wbn', Buffer.from(arrayBuffer));
        }),
      fetch(`${apiHost}/${screenshotHash}`)
        .then(res => res.arrayBuffer())
        .then(arrayBuffer => {
          fs.writeFileSync('a.wbn.gif', Buffer.from(arrayBuffer));
        }),
      fetch(`${apiHost}/${modelHash}`)
        .then(res => res.arrayBuffer())
        .then(arrayBuffer => {
          fs.writeFileSync('a.wbn.glb', Buffer.from(arrayBuffer));
        }),
    ]);

    console.log('a.wbn');
  })
  .command('build [input] [output]', 'build xrpackage .wbn from [input] and write to [output]', yargs => {
    yargs
      .positional('input', {
        describe: 'input file to build',
        // default: 5000
      })
      .positional('output', {
        describe: 'output file to write',
        // default: 5000
      });
  }, async argv => {
    handled = true;

    if (typeof argv.input !== 'string') {
      argv.input = '-';
    }
    if (typeof argv.output !== 'string') {
      argv.output = 'a.wbn';
    }

    let fileInput, xrType, mimeType, directory;
    const xrTypeToMimeType = {
      'gltf@0.0.1': 'model/gltf+json',
      'vrm@0.0.1': 'application/octet-stream',
      'vox@0.0.1': 'application/octet-stream',
      'webxr-site@0.0.1': 'text/html',
    };
    const _detectType = input => {
      if (/\.gltf$/.test(input)) {
        fileInput = input;
        xrType = 'gltf@0.0.1';
        xrMain = path.basename(fileInput);
        mimeType = xrTypeToMimeType[xrType];
        directory = null;
      } else if (/\.glb$/.test(input)) {
        fileInput = input;
        xrType = 'gltf@0.0.1';
        xrMain = path.basename(fileInput);
        mimeType = xrTypeToMimeType[xrType];
        directory = null;
      } else if (/\.vrm$/.test(input)) {
        fileInput = input;
        xrType = 'vrm@0.0.1';
        xrMain = path.basename(fileInput);
        mimeType = xrTypeToMimeType[xrType];
        directory = null;
      } else if (/\.vox$/.test(input)) {
        fileInput = input;
        xrType = 'vox@0.0.1';
        xrMain = path.basename(fileInput);
        mimeType = xrTypeToMimeType[xrType];
        directory = null;
      } else if (/\.html$/.test(input)) {
        fileInput = input;
        xrType = 'webxr-site@0.0.1';
        xrMain = path.basename(fileInput);
        mimeType = xrTypeToMimeType[xrType];
        directory = null;
      } else if (/\.json$/.test(input)) {
        const s = fs.readFileSync(input);
        const j = JSON.parse(s);
        if (typeof j.xr_type === 'string' && typeof j.xr_main === 'string') {
          xrType = j.xr_type;
          xrMain = j.xr_main;
          mimeType = xrTypeToMimeType[xrType];
          fileInput = path.join(path.dirname(input), xrMain);
          directory = path.dirname(input);
        } else {
          throw new Error(`manifest.json missing xr_type: ${input}`);
        }
      } else {
        const stats = fs.statSync(input);
        if (stats.isDirectory()) {
          _detectType(path.join(input, 'manifest.json'));
        } else {
          throw new Error(`unknown file type: ${argv.input}`);
        }
      }
    };
    _detectType(path.resolve(process.cwd(), argv.input));

    const fileData = fs.readFileSync(fileInput);
    // console.log('got data', data.length);

    const files = [
      {
        url: '/' + xrMain,
        type: mimeType,
        data: fileData,
      },
      {
        url: '/manifest.json',
        type: 'application/json',
        data: JSON.stringify({
          xr_type: xrType,
          xr_main: xrMain,
        }, null, 2),
      },
    ];
    if (directory) {
      const _readdirRecursive = rootDirectory => {
        const result = [];
        const _recurse = d => {
          const filenames = fs.readdirSync(d);
          for (let i = 0; i < filenames.length; i++) {
            const filename = path.join(d, filenames[i]);
            const stats = fs.lstatSync(filename);
            if (stats.isFile()) {
              result.push(filename.slice(rootDirectory.length));
            } else if (stats.isDirectory()) {
              _recurse(filename);
            }
          }
        };
        _recurse(rootDirectory);
        return result;
      };
      const filenames = _readdirRecursive(directory);
      for (let i = 0; i < filenames.length; i++) {
        const f = filenames[i];
        if (!files.some(({url}) => url === f)) {
          const type = mime.getType(f);
          const data = fs.readFileSync(path.join(directory, f));
          files.push({
            url: f,
            type,
            data,
          });
        }
      }
    }

    const primaryUrl = `https://xrpackage.org`;
    const builder = (new wbn.BundleBuilder(primaryUrl + '/' + xrMain))
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const {url, type, data} = file;
      builder.addExchange(primaryUrl + url, 200, {
        'Content-Type': type,
      }, data);
    }
    const uint8Array = builder.createBundle();
    // console.log('got bundle', uint8Array.byteLength);

    const app = express();
    app.get('/a.wbn', (req, res) => {
      res.end(uint8Array);
    });
    const gifPromise = makePromise();
    const _readIntoPromise = p => (req, res) => {
      const bs = [];
      req.on('data', d => {
        bs.push(d);
      });
      req.once('end', () => {
        const d = Buffer.concat(bs);
        p.accept(d);
        res.end();
      });
      req.once('error', p.reject);
    };
    app.put('/a.gif', _readIntoPromise(gifPromise));
    const glbPromise = makePromise();
    app.put('/a.glb', _readIntoPromise(glbPromise));
    app.use(express.static(__dirname));
    const port = 9999;
    const server = http.createServer(app);
    const connections = [];
    server.on('connection', c => {
      connections.push(c);
    });
    server.listen(port, () => {
      opn(`http://localhost:${port}/screenshot.html?srcWbn=http://localhost:${port}/a.wbn&dstGif=http://localhost:${port}/a.gif&dstGlb=http://localhost:${port}/a.glb`);
    });

    const [gifUint8Array, glbUint8Array] = await Promise.all([gifPromise, glbPromise]);
    server.close();
    for (let i = 0; i < connections.length; i++) {
      connections[i].destroy();
    }

    fs.writeFileSync(argv.output, uint8Array);
    fs.writeFileSync(argv.output + '.gif', gifUint8Array);
    fs.writeFileSync(argv.output + '.glb', glbUint8Array);
    console.log(argv.output);
  })
  .command('view [input]', 'view contents of input .wbn file', yargs => {
    yargs
      .positional('input', {
        describe: 'input .wbn file to view',
        // default: 5000
      });
  }, async argv => {
    handled = true;

    /* if (typeof argv.input !== 'string') {
      argv.input = '-';
    } */
    const d = fs.readFileSync(argv.input);
    const bundle = new wbn.Bundle(d);
    const files = [];
    for (const url of bundle.urls) {
      const response = bundle.getResponse(url);
      console.log(url);
      files.push({
        url,
        // status: response.status,
        // headers: response.headers,
        response,
        // body: response.body.toString('utf-8')
      });
    }
    // console.log(files.map());
  }).argv;
if (!handled) {
  yargs.showHelp();
}
  /* .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Run with verbose logging'
  }) */

/* if (argv.ships > 3 && argv.distance < 53.5) {
  console.log('Plunder more riffiwobbles!')
} else {
  console.log('Retreat from the xupptumblers!')
} */