'use strict';
const _sodium = require('libsodium-wrappers');


/**
 * Library Encryption
 *
 * @description Library for encryption support
 * @author Zefau <https://github.com/Zefau/>
 * @license MIT License
 * @version 0.2.0
 * @date 2019-06-08
 *
 */
class Encryption
{
	/**
	 * Constructor.
	 *
	 * @param	{object}	adapter		ioBroker adpater object
	 *
	 */
    constructor(adapter)
	{
		this._adapter = adapter;
    }
	
	/**
	 * Generates an encryption key.
	 *
	 * @param	void
	 * @return	{string}				Encryption key
	 *
	 */
	generateEncryptionKey()
	{
		return _sodium.to_hex(_sodium.crypto_secretbox_keygen());
	}
	
	/**
	 * Generates an encryption key.
	 *
	 * @param	{string}				Encryption key
	 * @return	{Buffer}				Encryption secret
	 *
	 */
	getEncryptionSecret(key)
	{
		let encryptionKey = Buffer.alloc(32);
		encryptionKey.fill(0);
		encryptionKey.write(key);
		return encryptionKey;
	}
	
	/**
	 * Encrypts a message with given key.
	 *
	 * @param	{string}	key			Key to be used to encrypt message
	 * @param	{string}	message		Message to be encrypted
	 * @return	{string}				Encrypted message
	 * @see https://www.npmjs.com/package/libsodium-wrappers#api
	 *
	 */
	encrypt(key, message)
	{
		try
		{
			let nonce = Buffer.from(_sodium.randombytes_buf(_sodium.crypto_box_NONCEBYTES));
			return Buffer.concat([nonce, Buffer.from(_sodium.crypto_secretbox_easy(Buffer.from(message), nonce, this.getEncryptionSecret(key)))]).toString('base64');
		}
		catch(err)
		{
			this._adapter.log.warn(err.message);
			return false;
		}
	}
	
	/**
	 * Decrypts a message with given key.
	 *
	 * @param	{string}	key			Key to be used to decrypt message
	 * @param	{string}	message		Message to be decrypted
	 * @return	{string}				Decrypted message
	 * @see https://www.npmjs.com/package/libsodium-wrappers#api
	 *
	 */
	decrypt(key, encrypted)
	{
		try
		{
			let encryptedBuffer = Buffer.from(encrypted, 'base64');
			let nonce = encryptedBuffer.slice(0, _sodium.crypto_box_NONCEBYTES);
			return _sodium.crypto_secretbox_open_easy(encryptedBuffer.slice(_sodium.crypto_box_NONCEBYTES), nonce, this.getEncryptionSecret(key), 'text');
		}
		catch(err)
		{
			this._adapter.log.warn(err.message);
			return false;
		}
	}
}

module.exports = Encryption;
