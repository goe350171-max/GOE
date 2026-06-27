from solders.transaction import Transaction
from solders.message import Message
from solders.hash import Hash


class TokenTransactionBuilder:

    def __init__(self, payer, recent_blockhash):
        self.payer = payer
        self.recent_blockhash = recent_blockhash
        self.instructions = []

    def add(self, instruction):
        self.instructions.append(instruction)

    def build(self):
        msg = Message.new_with_blockhash(
            self.instructions,
            self.payer,
            self.recent_blockhash,
        )

        return Transaction.new_unsigned(msg)
