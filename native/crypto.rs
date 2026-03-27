use anyhow::{anyhow, Result};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use aes::Aes256;
use cipher::{KeyIvInit, StreamCipher};
use hmac::{Hmac, Mac};

type Aes256Ctr = ctr::Ctr64BE<Aes256>;
type HmacSha256 = Hmac<Sha256>;

const ENC_NONE: u8 = 0x00;
const ENC_AES: u8 = 0x01;
const ENC_XOR: u8 = 0x02;
const ENC_AES_CTR: u8 = 0x03;
const PBKDF2_ITERS: u32 = 600_000;

pub fn encrypt_xor(data: &[u8], passphrase: &str) -> Vec<u8> {
    let key = passphrase.as_bytes();
    let mut result = Vec::with_capacity(1 + data.len());
    result.push(ENC_XOR);

    for (i, &byte) in data.iter().enumerate() {
        result.push(byte ^ key[i % key.len()]);
    }

    result
}

pub fn encrypt_aes(data: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, PBKDF2_ITERS, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    let cipher_len = ciphertext.len();
    if cipher_len < 16 {
        return Err(anyhow::anyhow!("Ciphertext too short"));
    }

    let tag = &ciphertext[cipher_len - 16..];
    let encrypted_data = &ciphertext[..cipher_len - 16];

    let mut result = Vec::with_capacity(1 + 16 + 12 + 16 + encrypted_data.len());
    result.push(ENC_AES);
    result.extend_from_slice(&salt);
    result.extend_from_slice(&iv);
    result.extend_from_slice(tag);
    result.extend_from_slice(encrypted_data);

    Ok(result)
}

pub fn no_encryption(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(1 + data.len());
    result.push(ENC_NONE);
    result.extend_from_slice(data);
    result
}

pub fn decrypt_xor(data: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    if data.is_empty() { return Err(anyhow!("Empty xor payload")); }
    if passphrase.is_empty() { return Err(anyhow!("Passphrase required")); }
    let key = passphrase.as_bytes();
    let mut out = Vec::with_capacity(data.len());
    for (i, &b) in data.iter().enumerate() {
        out.push(b ^ key[i % key.len()]);
    }
    Ok(out)
}

pub fn decrypt_aes(data: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    if data.len() < 1 + 16 + 12 + 16 { return Err(anyhow!("Invalid AES payload length")); }
    let salt = &data[1..17];
    let iv = &data[17..29];
    let tag = &data[29..45];
    let enc = &data[45..];

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERS, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

    let mut combined = Vec::with_capacity(enc.len() + tag.len());
    combined.extend_from_slice(enc);
    combined.extend_from_slice(tag);

    let nonce = Nonce::from_slice(iv);
    let decrypted = cipher.decrypt(nonce, combined.as_ref())
        .map_err(|e| anyhow!("AES decryption failed: {}", e))?;
    Ok(decrypted)
}

pub fn try_decrypt(buf: &[u8], passphrase: Option<&str>) -> Result<Vec<u8>> {
    if buf.is_empty() { return Err(anyhow!("Empty buffer")); }
    let flag = buf[0];
    match flag {
        ENC_NONE => Ok(buf[1..].to_vec()),
        ENC_XOR => {
            let pass = passphrase.ok_or_else(|| anyhow!("Passphrase required for XOR decryption"))?;
            decrypt_xor(&buf[1..], pass)
        }
        ENC_AES => {
            let pass = passphrase.ok_or_else(|| anyhow!("Passphrase required for AES decryption"))?;
            decrypt_aes(buf, pass)
        }
        ENC_AES_CTR => {
            let pass = passphrase.ok_or_else(|| anyhow!("Passphrase required for AES-CTR decryption"))?;
            decrypt_aes_ctr(buf, pass)
        }
        _ => Err(anyhow!("Unknown encryption flag: {}", flag)),
    }
}

pub fn derive_aes_ctr_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERS, &mut key);
    key
}

pub struct StreamingEncryptor {
    cipher: Aes256Ctr,
    hmac: HmacSha256,
    pub header: Vec<u8>,
}

impl StreamingEncryptor {
    pub fn new(passphrase: &str) -> Result<Self> {
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let mut iv = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut iv);

        let key = derive_aes_ctr_key(passphrase, &salt);
        let cipher = Aes256Ctr::new_from_slices(&key, &iv)
            .map_err(|e| anyhow!("AES-CTR init: {}", e))?;
        let hmac = <HmacSha256 as Mac>::new_from_slice(&key)
            .map_err(|e| anyhow!("HMAC init: {}", e))?;

        let mut header = Vec::with_capacity(1 + 16 + 16);
        header.push(ENC_AES_CTR);
        header.extend_from_slice(&salt);
        header.extend_from_slice(&iv);

        Ok(Self { cipher, hmac, header })
    }

    pub fn header_len(&self) -> usize {
        self.header.len()
    }

    pub fn encrypt_chunk(&mut self, buf: &mut [u8]) {
        self.cipher.apply_keystream(buf);
        self.hmac.update(buf);
    }

    pub fn finalize_hmac(self) -> [u8; 32] {
        let result = self.hmac.finalize();
        result.into_bytes().into()
    }
}

pub fn decrypt_aes_ctr(data: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    if data.len() < 1 + 16 + 16 + 32 {
        return Err(anyhow!("Invalid AES-CTR payload length"));
    }
    let salt = &data[1..17];
    let iv = &data[17..33];
    let hmac_tag = &data[data.len() - 32..];
    let ciphertext = &data[33..data.len() - 32];

    let key = derive_aes_ctr_key(passphrase, salt);

    let mut mac = <HmacSha256 as Mac>::new_from_slice(&key)
        .map_err(|e| anyhow!("HMAC init: {}", e))?;
    mac.update(ciphertext);
    mac.verify_slice(hmac_tag)
        .map_err(|_| anyhow!("HMAC verification failed - wrong passphrase or corrupted data"))?;

    let mut decrypted = ciphertext.to_vec();
    let mut cipher = Aes256Ctr::new_from_slices(&key, iv)
        .map_err(|e| anyhow!("AES-CTR init: {}", e))?;
    cipher.apply_keystream(&mut decrypted);

    Ok(decrypted)
}
