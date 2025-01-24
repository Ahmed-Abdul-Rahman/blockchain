export const getMiningRewardTransaction = (nodeAddress) => ({
  amount: 12.5,
  data: { message: `You have been given ${12.5} coin as a mining reward!` },
  senderAddress: '0000',
  recipientAddress: nodeAddress,
});
