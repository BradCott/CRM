import { createSign, createPublicKey, createHash, createPrivateKey } from 'node:crypto'

// Minimal CRX3 packer. Produces a signed .crx (Cr24 v3) that Chrome can install
// via enterprise policy. Ref: https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto

// protobuf: length-delimited (wire type 2) field
function varint(n) {
  const out = []
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128) }
  out.push(n)
  return Buffer.from(out)
}
function field(fieldNo, buf) {
  return Buffer.concat([varint((fieldNo << 3) | 2), varint(buf.length), buf])
}

export function getCrxIdentity(privateKeyPem) {
  const priv = createPrivateKey(privateKeyPem)
  const pubDer = createPublicKey(priv).export({ type: 'spki', format: 'der' })
  const hash = createHash('sha256').update(pubDer).digest()
  const id = [...hash.subarray(0, 16)]
    .map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 0xf)))
    .join('')
  return { priv, pubDer, crxId: hash.subarray(0, 16), id }
}

export function packCrx(zipBuffer, privateKeyPem) {
  const { priv, pubDer, crxId } = getCrxIdentity(privateKeyPem)

  // SignedData { bytes crx_id = 1 }
  const signedHeaderData = field(1, crxId)

  // Signature is over: "CRX3 SignedData\0" + uint32LE(len) + signedHeaderData + zip
  const magicCtx = Buffer.from('CRX3 SignedData\x00', 'latin1') // 16 bytes
  const lenLE = Buffer.alloc(4); lenLE.writeUInt32LE(signedHeaderData.length, 0)
  const signer = createSign('RSA-SHA256')
  signer.update(magicCtx); signer.update(lenLE); signer.update(signedHeaderData); signer.update(zipBuffer)
  const signature = signer.sign(priv)

  // CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000 }
  const proof = Buffer.concat([field(1, pubDer), field(2, signature)]) // AsymmetricKeyProof { public_key=1, signature=2 }
  const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)])

  const magic = Buffer.from('Cr24', 'ascii')
  const ver = Buffer.alloc(4); ver.writeUInt32LE(3, 0)
  const hlen = Buffer.alloc(4); hlen.writeUInt32LE(header.length, 0)
  return Buffer.concat([magic, ver, hlen, header, zipBuffer])
}
