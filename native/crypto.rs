use anyhow::Result;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

const ENC_NONE: u8 = 0x00;
const ENC_AES: u8 = 0x01;
const ENC_XOR: u8 = 0x02;
const PBKDF2_ITERS: u32 = 1_000_000;

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
