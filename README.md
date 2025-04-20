# Sample Hardhat Project

There is a zip in the oracle floder, just unzip and put the contents in the same path.
You should use hardhat to init the project.
You file structor should be like this.
<img width="1280" alt="image" src="https://github.com/user-attachments/assets/af8a0b72-7993-4455-9b96-89ef48e414d2" />
tips:
when you are doing the 'npx hardhat test' action, make sure there is only one test.js, if you want to test 'medicallnsurance.js' ,
then move out the 'fraudCase.js'. the same when you want to test 'fraudCase.js'



This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.js
```
