from solders.transaction import Transaction
from solders.message import Message


class TokenTransactionBuilder:

    def __init__(self, payer, recent_blockhash):
        self.payer = payer
        self.recent_blockhash = recent_blockhash
        self.instructions = []

    def add_instruction(self, instruction):
        self.instructions.append(instruction)

    def add_instructions(self, instructions):
        self.instructions.extend(instructions)

    def instruction_count(self):
        return len(self.instructions)

    def build(self):
        msg = Message.new_with_blockhash(
            self.instructions,
            self.payer,
            self.recent_blockhash,
        )

        return Transaction.new_unsigned(msg)
