use std::{path::Path,sync::Mutex};
use windows::{core::PCWSTR,Win32::{Foundation::{LocalFree,HLOCAL},Security::Cryptography::{CryptProtectData,CryptUnprotectData,CRYPT_INTEGER_BLOB}}};
static WRITE:Mutex<()>=Mutex::new(());
const MAGIC:&[u8]=b"COUCOU-DPAPI-1\0";
fn crypt(bytes:&[u8],encrypt:bool)->std::io::Result<Vec<u8>> {
    let input=CRYPT_INTEGER_BLOB{cbData:bytes.len().try_into().map_err(|_|std::io::Error::other("Storage too large"))?,pbData:bytes.as_ptr() as *mut u8};let mut output=CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result=if encrypt {CryptProtectData(&input,PCWSTR::null(),None,None,None,1,&mut output)}else{CryptUnprotectData(&input,None,None,None,None,1,&mut output)};
        result.map_err(std::io::Error::other)?;
        let value=std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec();let _=LocalFree(Some(HLOCAL(output.pbData as *mut _)));Ok(value)
    }
}
pub fn read(path:&Path)->std::io::Result<Vec<u8>> {let bytes=std::fs::read(path)?;if bytes.starts_with(MAGIC){crypt(&bytes[MAGIC.len()..],false)}else{Ok(bytes)}}
pub fn write(path:&Path,bytes:&[u8])->std::io::Result<()> {
    let _guard=WRITE.lock().unwrap();if let Some(parent)=path.parent(){crate::platform::ensure_private_dir(parent)?;}
    let encrypted=crypt(bytes,true)?;let mut data=MAGIC.to_vec();data.extend(encrypted);let temp=path.with_extension("encrypted.tmp");std::fs::write(&temp,data)?;std::fs::rename(temp,path)
}
